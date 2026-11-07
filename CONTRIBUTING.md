# Contributing

Start with the [development instructions](docs/development.md). Describe the problem and expected behavior with your change.

## Before submitting a pull request

- Use clear names, small functions and shallow control flow. Keep substantial Angular templates and component styles in separate files.
- Run `npm run check`. Tests use synthetic data and require no provider credentials.
- Add behavior-focused regression coverage for bugs where practical. Explain manual verification where automated coverage is unsuitable.
- Check UI changes at 320px, a typical mobile width and desktop. Verify wrapping, overflow, spacing and interactions, including keyboard use.
- Update documentation and any screenshots or diagrams made inaccurate by the change. Use sharp, readable images, descriptive alt text and clean framing; inspect rendered Markdown.
- Follow the [PR template](.github/pull_request_template.md), including a screenshot for visible changes. Never include credentials, `.env`, private information or generated build files.

## Data and licensing

Preserve third-party attribution and reference-data safeguards. Do not add manually maintained aircraft aliases or bypass reference-import validation. See the [aircraft reference guide](backend/data/README.md).

Project-owned contributions use the [MIT licence](LICENSE). Third-party material must retain its applicable terms and attribution.
