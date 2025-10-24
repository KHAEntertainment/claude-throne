# Thronekeeper - Universal AI Model Routing for VS Code

**Seamlessly use any AI model provider with Claude Code and other Anthropic-compatible clients.**

Thronekeeper is a powerful VS Code extension that acts as an intelligent proxy, allowing you to use OpenRouter, OpenAI, Together AI, Groq, or any OpenAI-compatible endpoint with tools that expect the Anthropic API format.

## ✨ Features

### 🎯 Universal Model Access
- **Multi-Provider Support**: Connect to OpenRouter (400+ models), OpenAI, Together AI, Groq, or custom endpoints
- **Smart Routing**: Automatically translates between Anthropic and OpenAI API formats
- **Two-Model Mode**: Use different models for reasoning (complex tasks) and execution (fast responses)
- **Provider Memory**: Model selections persist per provider - switch seamlessly between services

### 🔐 Security First
- **Secure Credential Storage**: API keys stored in VS Code's secure keychain, never in plain text
- **Workspace Isolation**: Settings can be scoped to workspace or global level
- **Anthropic Bypass**: Direct routing for Anthropic-compatible endpoints without proxy overhead

### 🎨 Modern UI Experience
- **Interactive Panel**: Beautiful configuration panel in VS Code's bottom panel area
- **Real-Time Model Loading**: Browse and search available models from each provider
- **Popular Pairings**: Pre-configured model combinations for optimal performance
- **Live Status Monitoring**: See proxy status, selected models, and health checks

<!-- Screenshot placeholders -->
![Thronekeeper Panel](images/panel-overview.png)
*The Thronekeeper configuration panel - manage providers, models, and settings*

![Model Selection](images/model-selection.png)
*Browse and search hundreds of available models with real-time loading*

![Two-Model Mode](images/two-model-mode.png)
*Configure separate models for reasoning and execution tasks*

## 🚀 Quick Start

### Installation
1. Install from VS Code Marketplace or download the `.vsix` file
2. Open the Thronekeeper panel: **View → Panel → Thronekeeper**
3. Select your AI provider and add your API key
4. Choose your models and click **Start Proxy**
5. Claude Code will automatically use your configured models!

### Basic Usage

#### OpenRouter (Recommended)
Access 400+ models including GPT-4, Claude, Gemini, and more:
1. Select "OpenRouter" as provider
2. Get your API key from [openrouter.ai/keys](https://openrouter.ai/keys)
3. Browse models or use popular pairings
4. Start proxy - done!

#### OpenAI
Use GPT-4, GPT-4 Turbo, and o1 models:
1. Select "OpenAI" as provider
2. Add your OpenAI API key
3. Select from available GPT models
4. Start proxy

#### Custom Provider
Connect to any OpenAI-compatible endpoint:
1. Select "Custom" as provider
2. Enter your endpoint URL (e.g., `https://api.example.com/v1`)
3. Add your API key
4. Enter model IDs manually or load from endpoint
5. Start proxy

## 🎮 Commands

Access these commands via the Command Palette (`Cmd/Ctrl + Shift + P`):

- `Thronekeeper: Open Panel` - Open the configuration panel
- `Thronekeeper: Start Proxy` - Start the proxy server
- `Thronekeeper: Stop Proxy` - Stop the proxy server
- `Thronekeeper: Show Status` - Display current proxy status
- `Thronekeeper: Apply to Claude Code` - Configure Claude Code to use the proxy
- `Thronekeeper: Revert Claude Code` - Restore original Claude Code settings

## ⚙️ Configuration

### Extension Settings

- `claudeThrone.provider` - Default AI provider (openrouter, openai, together, grok, custom)
- `claudeThrone.twoModelMode` - Enable separate reasoning/execution models
- `claudeThrone.reasoningModel` - Primary model for complex reasoning tasks
- `claudeThrone.completionModel` - Fast model for code completion
- `claudeThrone.proxy.port` - Proxy server port (default: 3000)
- `claudeThrone.autoApply` - Auto-configure Claude Code on proxy start
- `claudeThrone.applyScope` - Settings scope (workspace or global)
- `claudeThrone.customBaseUrl` - Custom provider endpoint URL

### Two-Model Mode

Optimize performance by using different models for different tasks:
- **Reasoning Model**: Complex analysis, planning, debugging (e.g., GPT-4, Claude Opus)
- **Execution Model**: Fast completions, simple tasks (e.g., GPT-3.5, Claude Haiku)

## 🔧 Advanced Features

### Provider-Specific Model Persistence
Models are saved per provider, so switching between OpenRouter and OpenAI maintains your selections for each.

### Anthropic Endpoint Detection
Custom URLs pointing to Anthropic-compatible services bypass the proxy for direct connection.

### Manual Model Entry
If a custom provider can't list models, enter them manually with comma-separated IDs.

### Health Monitoring
The proxy includes health checks with automatic recovery and detailed logging.

## 🐛 Troubleshooting

### "Unable to connect to API"
- Check that the proxy is running (green status in panel)
- Verify your API key is correct
- Check the Output panel for detailed logs

### Models not loading
- Ensure you have a valid API key stored
- For custom providers, verify the endpoint URL
- Try entering model IDs manually if auto-loading fails

### Proxy won't start
- Check if port 3000 (or configured port) is available
- Look for errors in the Output panel (Thronekeeper channel)
- Try stopping and restarting the proxy

## 📚 Resources

- [GitHub Repository](https://github.com/KHAEntertainment/thronekeeper)
- [Issue Tracker](https://github.com/KHAEntertainment/thronekeeper/issues)
- [OpenRouter Models](https://openrouter.ai/models)
- [API Documentation](https://github.com/KHAEntertainment/thronekeeper#api-documentation)

## 📄 License

MIT License - See [LICENSE](LICENSE) for details

## 🙏 Acknowledgments

Thronekeeper evolved from [anthropic-proxy](https://github.com/maxnowack/anthropic-proxy) by Max Nowack. Special thanks to the open-source community and all contributors.

---

**Version 1.4.9** | Made with ❤️ for the AI development community

