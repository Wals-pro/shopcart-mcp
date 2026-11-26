# Security Policy

## Supported Versions

Security fixes are provided for the latest release and the `main` branch:

| Version | Supported |
| ------- | --------- |
| `main` / latest `0.5.x` | Yes |
| `< 0.5.0` | No |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

- **Primary channel (preferred):** Submit a confidential report via [GitHub Private Vulnerability Reporting](https://github.com/Wals-pro/shopcart-mcp/security/advisories/new).
- **Fallback channel:** Email [support@wals.pro](mailto:support@wals.pro) (or [security@wals.pro](mailto:security@wals.pro) as listed in `/.well-known/security.txt`) with the subject prefix `[Security] shopcart-mcp`.

Please include as much of the following as possible so we can triage quickly:

- Affected component, version, or commit SHA
- Clear reproduction steps or a minimal proof of concept
- Expected vs. actual behavior and potential security impact
- Any suggested remediation or workaround

## Scope

### In Scope

- ShopCart MCP server (local `stdio` CLI and hosted OAuth 2.1 Streamable HTTP server)
- Storefront adapters (Shopify, WooCommerce, Amazon, BigCommerce, Shopware 6, Magento 2, Universal JSON-LD, and Awin feed integration)
- SSRF protections, URL validation, and prompt-injection / HTML sanitization
- Hosted web portal, OAuth 2.1, passwordless email OTP / magic-link auth, and Stripe billing endpoints
- `.mcpb` desktop extension build and packaging (`scripts/build-mcpb.mjs`)

### Out of Scope

- Vulnerabilities in third-party merchant storefronts or upstream commerce platforms (Shopify, WooCommerce, Amazon, BigCommerce, Shopware, Magento, etc.)
- Vulnerabilities in third-party AI clients or MCP hosts
- Automated vulnerability scanner noise without a demonstrable security impact
- Volumetric denial-of-service (DoS/DDoS) or social engineering testing against hosted infrastructure

## Response Targets & Coordinated Disclosure

- **Acknowledgement:** Within 48 hours (2 business days).
- **Initial triage & severity assessment:** Within 5 business days.
- **Coordinated disclosure:** We follow coordinated vulnerability disclosure. Please allow us a reasonable window to develop, test, and release a fix before publishing details. Credit will be given in the security advisory and release notes unless you prefer to remain anonymous.
