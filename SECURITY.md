# Security Policy / 安全策略

## Reporting a Vulnerability / 报告漏洞

If you discover a security vulnerability in MeetU, please report it responsibly.

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please email: **meetu.app@outlook.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for a fix.

如果您发现 MeetU 的安全漏洞，请发送邮件至上述邮箱，不要公开提交 Issue。

## Scope / 范围

The following are in scope:
- API Key exposure or leakage
- Local data access without authorization
- Electron security issues (e.g., nodeIntegration bypass)
- Dependency vulnerabilities

## Security Design / 安全设计

- API keys encrypted via OS-level `safeStorage`
- `contextIsolation: true`, `nodeIntegration: false`
- Content Security Policy enforced
- No remote code execution
- All dependencies audited for GPL/AGPL compliance
