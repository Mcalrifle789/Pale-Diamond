/**
 * Omaris — the small declarative rule language Pale Diamond uses to decide ad
 * behaviour, plan gating and model routing without recompiling the front end.
 *
 * Rules live in `public/rules/*.oma` and are fetched at runtime, so product
 * policy can change without a redeploy of the application logic.
 *
 * Grammar
 * -------
 *   program := rule*
 *   rule    := 'rule' IDENT '{' statement* '}'
 *   stmt    := 'when' expr
 *            | 'set' IDENT value
 *            | ('show' | 'hide') target
 *            | ('grant' | 'deny') target
 *            | 'route' 'to' target
 *   expr    := cmp (('and' | 'or') cmp)*
 *   cmp     := IDENT op value
 *   op      := 'is' | 'is not' | 'in' | 'not in' | '>' | '<' | '>=' | '<='
 *   value   := STRING | NUMBER | 'true' | 'false' | '[' value (',' value)* ']'
 *
 * Lines beginning with `#` are comments.
 */

export type OmarisValue = string | number | boolean | OmarisValue[];

export interface OmarisContext {
  [key: string]: OmarisValue | undefined;
}

type Comparison = { field: string; op: string; value: OmarisValue };
type Condition = { kind: 'and' | 'or'; parts: Comparison[] };

export type OmarisAction =
  | { type: 'set'; key: string; value: OmarisValue }
  | { type: 'show'; target: string }
  | { type: 'hide'; target: string }
  | { type: 'grant'; capability: string }
  | { type: 'deny'; capability: string }
  | { type: 'route'; destination: string };

export interface OmarisRule {
  name: string;
  condition: Condition | null;
  actions: OmarisAction[];
}

export interface OmarisDecision {
  /** Values collected from every `set` in a matching rule. */
  settings: Record<string, OmarisValue>;
  visible: Set<string>;
  hidden: Set<string>;
  granted: Set<string>;
  denied: Set<string>;
  route: string | null;
  /** Names of the rules that fired, useful when debugging policy. */
  matched: string[];
}

// --- Lexer -----------------------------------------------------------------

type Token = { kind: 'ident' | 'string' | 'number' | 'punct'; text: string; line: number };

const PUNCT = new Set(['{', '}', '[', ']', ',']);
const KEYWORDS = ['when', 'set', 'show', 'hide', 'grant', 'deny', 'route', 'rule'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;

  for (let i = 0; i < source.length; ) {
    const ch = source[i];

    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    if (ch === '#') {                                   // comment runs to end of line
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    if (ch === '"') {                                   // quoted string
      let text = '';
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\' && i + 1 < source.length) { text += source[i + 1]; i += 2; continue; }
        text += source[i++];
      }
      i++;                                              // closing quote
      tokens.push({ kind: 'string', text, line });
      continue;
    }

    if (PUNCT.has(ch)) { tokens.push({ kind: 'punct', text: ch, line }); i++; continue; }

    if (/[0-9]/.test(ch)) {                             // number literal
      let text = '';
      while (i < source.length && /[0-9.]/.test(source[i])) text += source[i++];
      tokens.push({ kind: 'number', text, line });
      continue;
    }

    if (/[><=!]/.test(ch)) {                            // comparison operator
      let text = '';
      while (i < source.length && /[><=!]/.test(source[i])) text += source[i++];
      tokens.push({ kind: 'punct', text, line });
      continue;
    }

    let text = '';                                      // bare identifier / keyword
    while (i < source.length && /[A-Za-z0-9_.-]/.test(source[i])) text += source[i++];
    if (text === '') { i++; continue; }                 // skip anything unrecognised
    tokens.push({ kind: 'ident', text, line });
  }

  return tokens;
}

// --- Parser ----------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }

  private expect(text: string): Token {
    const token = this.next();
    if (!token || token.text !== text) {
      const found = token ? token.text : '<eof>';
      const where = token ? token.line : 0;
      throw new SyntaxError('omaris: expected "' + text + '" but found "' + found + '" on line ' + where);
    }
    return token;
  }

  parseProgram(): OmarisRule[] {
    const rules: OmarisRule[] = [];
    while (this.peek()) {
      if (this.peek()!.text !== 'rule') { this.next(); continue; }
      rules.push(this.parseRule());
    }
    return rules;
  }

  private parseRule(): OmarisRule {
    this.expect('rule');
    const name = this.next()?.text ?? 'anonymous';
    this.expect('{');

    const rule: OmarisRule = { name, condition: null, actions: [] };

    while (this.peek() && this.peek()!.text !== '}') {
      const keyword = this.next()!;
      switch (keyword.text) {
        case 'when':
          rule.condition = this.parseCondition();
          break;
        case 'set': {
          const key = this.next()?.text ?? '';
          rule.actions.push({ type: 'set', key, value: this.parseValue() });
          break;
        }
        case 'show':
        case 'hide': {
          const target = this.parseTarget();
          rule.actions.push({ type: keyword.text === 'show' ? 'show' : 'hide', target });
          break;
        }
        case 'grant':
        case 'deny': {
          const capability = this.parseTarget();
          rule.actions.push({ type: keyword.text === 'grant' ? 'grant' : 'deny', capability });
          break;
        }
        case 'route':
          if (this.peek()?.text === 'to') this.next();
          rule.actions.push({ type: 'route', destination: this.parseTarget() });
          break;
        default:
          break;                                        // tolerate unknown statements
      }
    }

    this.expect('}');
    return rule;
  }

  /**
   * Accepts `slot "rail"`, `slot rail` and a bare `"rail"`. The optional
   * leading noun reads better in rule files but carries no meaning.
   */
  private parseTarget(): string {
    const token = this.next();
    if (!token) return '';

    const following = this.peek();
    const followingIsValue = !!following
      && (following.kind === 'string' || following.kind === 'ident')
      && !KEYWORDS.includes(following.text);

    if (token.kind === 'ident' && followingIsValue) return this.next()!.text;
    return token.text;
  }

  private parseCondition(): Condition {
    const parts: Comparison[] = [this.parseComparison()];
    let kind: 'and' | 'or' = 'and';

    while (this.peek() && (this.peek()!.text === 'and' || this.peek()!.text === 'or')) {
      kind = this.next()!.text as 'and' | 'or';
      parts.push(this.parseComparison());
    }

    return { kind, parts };
  }

  private parseComparison(): Comparison {
    const field = this.next()?.text ?? '';
    let op = this.next()?.text ?? 'is';

    if (op === 'is' && this.peek()?.text === 'not') { this.next(); op = 'is not'; }
    if (op === 'not' && this.peek()?.text === 'in') { this.next(); op = 'not in'; }

    return { field, op, value: this.parseValue() };
  }

  private parseValue(): OmarisValue {
    const token = this.next();
    if (!token) return '';

    if (token.text === '[') {
      const items: OmarisValue[] = [];
      while (this.peek() && this.peek()!.text !== ']') {
        if (this.peek()!.text === ',') { this.next(); continue; }
        items.push(this.parseValue());
      }
      this.expect(']');
      return items;
    }

    if (token.kind === 'number') return Number(token.text);
    if (token.kind === 'string') return token.text;
    if (token.text === 'true') return true;
    if (token.text === 'false') return false;
    return token.text;
  }
}

export function parse(source: string): OmarisRule[] {
  return new Parser(tokenize(source)).parseProgram();
}

// --- Evaluator -------------------------------------------------------------

function compare(comparison: Comparison, context: OmarisContext): boolean {
  const { field, op, value } = comparison;
  const actual = context[field];

  switch (op) {
    case 'is':
    case '==':
      return actual === value;
    case 'is not':
    case '!=':
      return actual !== value;
    case 'in':
      return Array.isArray(value) && value.includes(actual as OmarisValue);
    case 'not in':
      return Array.isArray(value) && !value.includes(actual as OmarisValue);
    case '>':
      return Number(actual) > Number(value);
    case '<':
      return Number(actual) < Number(value);
    case '>=':
      return Number(actual) >= Number(value);
    case '<=':
      return Number(actual) <= Number(value);
    default:
      return false;
  }
}

function matches(condition: Condition | null, context: OmarisContext): boolean {
  if (!condition) return true;                          // unconditional rules always fire
  return condition.kind === 'or'
    ? condition.parts.some((part) => compare(part, context))
    : condition.parts.every((part) => compare(part, context));
}

/** Run every rule against `context` and fold the actions into one decision. */
export function evaluate(rules: OmarisRule[], context: OmarisContext): OmarisDecision {
  const decision: OmarisDecision = {
    settings: {},
    visible: new Set<string>(),
    hidden: new Set<string>(),
    granted: new Set<string>(),
    denied: new Set<string>(),
    route: null,
    matched: [],
  };

  for (const rule of rules) {
    if (!matches(rule.condition, context)) continue;
    decision.matched.push(rule.name);

    for (const action of rule.actions) {
      switch (action.type) {
        case 'set':   decision.settings[action.key] = action.value; break;
        case 'show':  decision.visible.add(action.target); decision.hidden.delete(action.target); break;
        case 'hide':  decision.hidden.add(action.target); decision.visible.delete(action.target); break;
        case 'grant': decision.granted.add(action.capability); decision.denied.delete(action.capability); break;
        case 'deny':  decision.denied.add(action.capability); decision.granted.delete(action.capability); break;
        case 'route': decision.route = action.destination; break;
      }
    }
  }

  return decision;
}

/** Fetch and parse an `.oma` file, returning an empty program if unavailable. */
export async function load(url: string): Promise<OmarisRule[]> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return parse(await response.text());
  } catch (error) {
    console.warn('[omaris] could not load ' + url, error);
    return [];
  }
}

/** Read a setting with a typed fallback. */
export function setting<T extends OmarisValue>(decision: OmarisDecision, key: string, fallback: T): T {
  const value = decision.settings[key];
  return (value === undefined ? fallback : value) as T;
}
