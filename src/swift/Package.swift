// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RevenueSplit",
    products: [
        .library(name: "RevenueSplit", targets: ["RevenueSplit"]),
    ],
    targets: [
        .target(name: "RevenueSplit"),
        .testTarget(name: "RevenueSplitTests", dependencies: ["RevenueSplit"]),
    ]
)
