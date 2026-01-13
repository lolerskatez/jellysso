# Contributing to JellySSO

Thank you for your interest in contributing to JellySSO! This document provides guidelines and instructions for contributing to the project.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/jellysso.git
   cd jellysso
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your local development settings
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

## Code Standards

- **Style**: Follow existing code patterns in the project
- **Testing**: Write tests for new features
- **Commits**: Use clear, descriptive commit messages
- **Documentation**: Update relevant documentation for changes

## Testing

Before submitting a pull request, ensure:

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:comprehensive

# Run benchmarks (optional)
npm run benchmark
```

## Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new functionality
3. **Ensure all tests pass**: `npm test`
4. **Create a descriptive PR** with:
   - Clear title and description
   - Reference to any related issues
   - Summary of changes
5. **Address review feedback** promptly

## Reporting Issues

When reporting bugs, please include:

- **Description**: Clear explanation of the issue
- **Steps to reproduce**: Detailed reproduction steps
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Environment**: Node.js version, OS, etc.
- **Logs**: Relevant error messages or logs

## Feature Requests

Feature requests are welcome! Please provide:

- **Use case**: Why this feature is needed
- **Proposed solution**: How it should work
- **Alternatives**: Any alternative approaches considered

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Help others learn and grow

## Questions?

Feel free to open an issue or discussion for questions about contributing.

Thank you for helping make JellySSO better! 🎉
