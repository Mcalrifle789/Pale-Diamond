const toast = document.querySelector('.toast');
const authModal = document.querySelector('#auth-modal');
const paygoModal = document.querySelector('#paygo-modal');
const authForm = document.querySelector('#auth-form');
const modalModeLabel = document.querySelector('#modal-mode-label');
const modalTitle = document.querySelector('#modal-title');
const modalSubtitle = document.querySelector('#modal-subtitle');
const authSubmit = document.querySelector('#auth-submit');
const modalSwitchCopy = document.querySelector('#modal-switch-copy');
const modalSwitchButton = document.querySelector('#modal-switch-button');
let authMode = 'signup';

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function openAuth(mode = 'signup') {
  authMode = mode;
  const signin = mode === 'signin';
  modalModeLabel.textContent = signin ? 'SIGN IN' : 'WELCOME';
  modalTitle.innerHTML = signin ? 'Welcome<br /><em>back.</em>' : 'Make room for<br /><em>better work.</em>';
  modalSubtitle.textContent = signin ? 'Pick up where you left off.' : 'Create your private workspace in a few seconds.';
  authSubmit.innerHTML = signin ? 'Enter workspace <span>↗</span>' : 'Create workspace <span>↗</span>';
  modalSwitchCopy.textContent = signin ? 'New to Pale Diamond?' : 'Already have an account?';
  modalSwitchButton.textContent = signin ? 'Create an account' : 'Sign in';
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => authModal.querySelector('input')?.focus(), 100);
}

function closeModal(modal) {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('[data-open-auth]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.openAuth)));
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop'))));
document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop); }));
modalSwitchButton.addEventListener('click', () => openAuth(authMode === 'signup' ? 'signin' : 'signup'));

authForm.addEventListener('submit', event => {
  event.preventDefault();
  const email = new FormData(authForm).get('email');
  localStorage.setItem('paleDiamondUser', JSON.stringify({ email, mode: authMode, joined: new Date().toISOString() }));
  closeModal(authModal);
  showToast(authMode === 'signin' ? `Welcome back, ${email.split('@')[0]}.` : 'Your private workspace is ready to explore.');
  authForm.reset();
});

document.querySelectorAll('[data-provider]').forEach(button => button.addEventListener('click', () => {
  closeModal(authModal);
  showToast(`${button.dataset.provider} sign-in is ready to connect.`);
}));

document.querySelectorAll('[data-plan]').forEach(button => button.addEventListener('click', () => {
  const plan = button.dataset.plan;
  localStorage.setItem('paleDiamondPlan', plan);
  openAuth('signup');
  showToast(`${plan} selected — create your workspace to continue.`);
}));

document.querySelector('[data-paygo]')?.addEventListener('click', () => { paygoModal.classList.add('open'); paygoModal.setAttribute('aria-hidden', 'false'); });
document.querySelectorAll('[data-credits]').forEach(button => button.addEventListener('click', () => {
  localStorage.setItem('paleDiamondCredits', button.dataset.credits);
  closeModal(paygoModal);
  showToast(`A $${button.dataset.credits} usage pack was selected.`);
}));

document.querySelector('.menu-button')?.addEventListener('click', () => {
  document.querySelector('.main-nav').classList.toggle('mobile-open');
  const nav = document.querySelector('.main-nav');
  if (nav.classList.contains('mobile-open')) {
    nav.style.display = 'flex'; nav.style.position = 'absolute'; nav.style.top = '74px'; nav.style.left = '0'; nav.style.right = '0'; nav.style.padding = '22px 24px'; nav.style.background = '#0c101c'; nav.style.flexDirection = 'column'; nav.style.gap = '18px';
  } else nav.removeAttribute('style');
});

document.querySelectorAll('.billing-toggle button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.billing-toggle button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const yearly = button.textContent.includes('Yearly');
  document.querySelectorAll('.price b').forEach((price, index) => {
    const monthly = ['$0', '$20', '$45', '$115'];
    const annual = ['$0', '$16', '$36', '$92'];
    price.textContent = (yearly ? annual : monthly)[index];
  });
  showToast(yearly ? 'Yearly billing selected — 20% saved.' : 'Monthly billing selected.');
}));

document.querySelector('.ad-window-top button')?.addEventListener('click', event => {
  event.currentTarget.closest('.ad-window').style.opacity = '0';
  event.currentTarget.closest('.ad-window').style.transform = 'rotate(3deg) scale(.96)';
  showToast('Ad dismissed. Your attention stays yours.');
});

document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => {
  document.querySelector('.main-nav')?.classList.remove('mobile-open');
}));
