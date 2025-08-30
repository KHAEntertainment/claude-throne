# Claude-Throne Project Specification
*"Choose Your Queen - Advanced AI Model Routing for Claude Code"*

## Project Overview

**Repository:** https://github.com/KHAEntertainment/claude-throne  
**Ecosystem:** The Hive  
**Goal:** Fix anthropic-proxy limitations and create a comprehensive VS Code extension for AI model routing

### Core Problems Solved
1. **Bug Fix:** anthropic-proxy doesn't support API keys for custom providers
2. **UX Enhancement:** Complex environment variable setup → Simple GUI configuration
3. **Ecosystem Integration:** Standalone tool → The Hive ecosystem component

## Phase 1: Enhanced Anthropic Proxy

### Critical Bug Fix: API Key Resolution

**Current Issue (lines 4-6 in index.js):**
```javascript
const baseUrl = process.env.ANTHROPIC_PROXY_BASE_URL || 'https://openrouter.ai/api'
const requiresApiKey = !process.env.ANTHROPIC_PROXY_BASE_URL  // BUG: No auth for custom URLs
const key = requiresApiKey ? process.env.OPENROUTER_API_KEY : null
```

**Solution: Create `src/key-resolver.js`:**
```javascript
export function getApiKey() {
  const customUrl = process.env.ANTHROPIC_PROXY_BASE_URL
  
  if (customUrl) {
    // Smart key resolution for custom providers
    const customKey = process.env.CUSTOM_API_KEY || process.env.API_KEY
    
    // Provider-specific fallbacks based on URL patterns
    if (customUrl.includes('openai.com') && !customKey) return process.env.OPENAI_API_KEY
    if (customUrl.includes('together.xyz') && !customKey) return process.env.TOGETHER_API_KEY
    if (customUrl.includes('groq.com') && !customKey) return process.env.GROQ_API_KEY
    
    return customKey || process.env.OPENROUTER_API_KEY
  }
  
  return process.env.OPENROUTER_API_KEY // Default OpenRouter
}

export function getProviderFromUrl(url) {
  if (url.includes('openai.com')) return 'openai'
  if (url.includes('together.xyz')) return 'together'  
  if (url.includes('groq.com')) return 'groq'
  if (url.includes('openrouter.ai')) return 'openrouter'
  return 'custom'
}

export function validateConfiguration() {
  const key = getApiKey()
  const provider = getProviderFromUrl(process.env.ANTHROPIC_PROXY_BASE_URL || 'https://openrouter.ai/api')
  
  if (!key) {
    console.error(`❌ No API key found for provider: ${provider}`)
    console.error(`💡 Set one of: CUSTOM_API_KEY, API_KEY, ${provider.toUpperCase()}_API_KEY`)
    return false
  }
  
  console.log(`🎯 Claude-Throne configured for ${provider} provider`)
  return true
}
```

**Enhanced index.js (top section):**
```javascript
#!/usr/bin/env node
import Fastify from 'fastify'
import { TextDecoder } from 'util'
import { getApiKey, getProviderFromUrl, validateConfiguration } from './src/key-resolver.js'

// Validate configuration before starting
if (!validateConfiguration()) process.exit(1)

const baseUrl = process.env.ANTHROPIC_PROXY_BASE_URL || 'https://openrouter.ai/api'
const key = getApiKey()
const provider = getProviderFromUrl(baseUrl)
const model = 'google/gemini-2.0-pro-exp-02-05:free'
const models = {
  reasoning: process.env.REASONING_MODEL || model,
  completion: process.env.COMPLETION_MODEL || model,
}

console.log(`👑 Claude-Throne Starting`)
console.log(`🎯 Provider: ${provider}`)
console.log(`🤖 Reasoning: ${models.reasoning}`)
console.log(`⚡ Completion: ${models.completion}`)
console.log(`🚀 Listening on port ${process.env.PORT || 3000}`)
```

**Enhanced Headers (around line 135):**
```javascript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${key}`, // Always include auth header
  'User-Agent': 'Claude-Throne/1.0.0'
}

// Provider-specific headers
if (provider === 'openrouter') {
  headers['HTTP-Referer'] = 'https://github.com/KHAEntertainment/claude-throne'
  headers['X-Title'] = 'Claude-Throne-Proxy'
}
```

### Enhanced Environment Variables Support
```bash
# Provider Selection
ANTHROPIC_PROXY_BASE_URL=https://api.together.xyz/v1  # Custom provider
ANTHROPIC_PROXY_PROVIDER=together                     # Provider hint

# API Keys (smart resolution)
OPENROUTER_API_KEY=sk-or-...     # OpenRouter
OPENAI_API_KEY=sk-...            # OpenAI
TOGETHER_API_KEY=...             # Together AI
GROQ_API_KEY=gsk_...             # Groq
CUSTOM_API_KEY=...               # Generic custom
API_KEY=...                      # Ultimate fallback

# Model Configuration
REASONING_MODEL=deepseek/deepseek-chat-v3.1:free
COMPLETION_MODEL=qwen/qwen3-coder:free

# Debugging
DEBUG=1
PORT=3000
```

### Test Configuration
Create test script `scripts/test-providers.sh`:
```bash
#!/bin/bash
echo "🧪 Testing Claude-Throne with multiple providers..."

# Test OpenRouter
echo "Testing OpenRouter..."
OPENROUTER_API_KEY=$(security find-generic-password -w -s "openrouter-api-key" -a "$USER") \
REASONING_MODEL="deepseek/deepseek-chat-v3.1:free" \
COMPLETION_MODEL="qwen/qwen3-coder:free" \
DEBUG=1 npm start &

sleep 5
curl -X POST http://localhost:3000/v1/messages -H "Content-Type: application/json" -d '{"model":"test","messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
kill %1

# Test Custom Provider (Together AI)
echo "Testing Together AI..."
ANTHROPIC_PROXY_BASE_URL="https://api.together.xyz/v1" \
TOGETHER_API_KEY="your-together-key" \
REASONING_MODEL="meta-llama/Llama-3.3-70B-Instruct-Turbo" \
DEBUG=1 npm start &

sleep 5
curl -X POST http://localhost:3000/v1/messages -H "Content-Type: application/json" -d '{"model":"test","messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
kill %1
```

## Phase 2: VS Code Extension Architecture

### Extension Structure
```
claude-throne-extension/
├── package.json
├── src/
│   ├── extension.ts              # Main extension entry
│   ├── panels/
│   │   ├── ConfigPanel.ts        # WebView controller
│   │   └── ProxyManager.ts       # Proxy lifecycle management
│   ├── services/
│   │   ├── CredentialManager.ts  # Secure credential storage
│   │   ├── ModelSuggestions.ts   # AI model intelligence
│   │   └── ProviderService.ts    # Provider-specific logic
│   └── webview/
│       ├── index.html
│       ├── main.tsx              # React UI entry
│       ├── components/
│       │   ├── ConfigForm.tsx
│       │   ├── ModelSelector.tsx
│       │   ├── PopularModels.tsx
│       │   └── StatusIndicator.tsx
│       └── styles/
│           └── hive-theme.css
├── python-backend/
│   ├── claude_throne_backend.py  # FastAPI server
│   ├── keyring_manager.py        # Cross-platform credentials
│   ├── model_intelligence.py     # Model suggestions & validation
│   ├── proxy_controller.py       # Proxy process management
│   └── requirements.txt
├── resources/
│   ├── icons/
│   │   ├── throne-light.svg
│   │   └── throne-dark.svg
│   ├── data/
│   │   ├── providers.json
│   │   ├── popular-models.json
│   │   └── model-pairings.json
│   └── templates/
└── scripts/
    ├── install-dependencies.sh
    └── setup-python-env.sh
```

### Core Configuration Interface
```typescript
interface ClaudeThroneConfig {
  // Provider Configuration
  provider: 'openrouter' | 'openai' | 'together' | 'groq' | 'custom'
  customUrl?: string
  
  // Model Selection
  reasoningModel: string
  executionModel?: string // Optional - uses reasoning if blank
  
  // Authentication
  apiKey: string // Stored securely via Python keyring
  
  // Proxy Settings
  port: number // Default 3000
  debug: boolean
  autoStart: boolean
  
  // UI Preferences
  showPopularModels: boolean
  theme: 'auto' | 'light' | 'dark'
}

interface ModelSuggestion {
  id: string
  name: string
  provider: string
  cost: 'Free' | '$' | '$$' | '$$$'
  contextWindow: string
  strengths: string[]
  description: string
  popularity: number
}

interface ModelPairing {
  name: string
  reasoningModel: string
  executionModel: string
  totalContext: string
  description: string
  costTier: 'Free' | 'Budget' | 'Premium'
  useCase: string[]
}
```

### Python Backend Core (`python-backend/claude_throne_backend.py`)
```python
import keyring
import subprocess
import json
import asyncio
from typing import Optional, Dict, List
from fastapi import FastAPI, HTTPException
from dataclasses import dataclass, asdict
import psutil

@dataclass
class ProxyConfig:
    provider: str
    custom_url: Optional[str]
    reasoning_model: str
    execution_model: Optional[str]
    api_key: str
    debug: bool
    port: int = 3000

class ClaudeThroneBackend:
    def __init__(self):
        self.app = FastAPI(title="Claude-Throne Backend")
        self.proxy_process = None
        self.setup_routes()
    
    def setup_routes(self):
        @self.app.post("/start-proxy")
        async def start_proxy(config: ProxyConfig):
            return {"success": self.start_proxy(config)}
        
        @self.app.post("/stop-proxy") 
        async def stop_proxy():
            return {"success": self.stop_proxy()}
            
        @self.app.get("/proxy-status")
        async def get_status():
            return {"running": self.is_proxy_running()}
            
        @self.app.post("/store-credentials")
        async def store_credentials(provider: str, api_key: str):
            return {"success": self.store_api_key(provider, api_key)}
            
        @self.app.get("/get-popular-models")
        async def get_popular_models():
            return self.get_model_suggestions()
    
    def store_api_key(self, provider: str, api_key: str) -> bool:
        """Store API key securely via keyring"""
        try:
            keyring.set_password("claude-throne", f"{provider}-api-key", api_key)
            return True
        except Exception as e:
            print(f"Failed to store API key: {e}")
            return False
    
    def get_api_key(self, provider: str) -> Optional[str]:
        """Retrieve API key from keyring"""
        try:
            return keyring.get_password("claude-throne", f"{provider}-api-key")
        except Exception:
            return None
    
    def start_proxy(self, config: ProxyConfig) -> bool:
        """Start the claude-throne proxy"""
        if self.proxy_process and self.proxy_process.poll() is None:
            return False  # Already running
            
        env_vars = {
            "PORT": str(config.port),
            "REASONING_MODEL": config.reasoning_model,
            "DEBUG": "1" if config.debug else "0"
        }
        
        if config.execution_model:
            env_vars["COMPLETION_MODEL"] = config.execution_model
            
        # Set API key and provider-specific settings
        if config.provider == "custom" and config.custom_url:
            env_vars["ANTHROPIC_PROXY_BASE_URL"] = config.custom_url
            env_vars["CUSTOM_API_KEY"] = config.api_key
        else:
            env_vars[f"{config.provider.upper()}_API_KEY"] = config.api_key
            
        try:
            self.proxy_process = subprocess.Popen(
                ["npx", "claude-throne"],
                env={**os.environ, **env_vars},
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            return True
        except Exception as e:
            print(f"Failed to start proxy: {e}")
            return False
    
    def stop_proxy(self) -> bool:
        """Stop the running proxy"""
        if self.proxy_process:
            self.proxy_process.terminate()
            self.proxy_process.wait()
            self.proxy_process = None
            return True
        return False
    
    def is_proxy_running(self) -> bool:
        """Check if proxy is running"""
        return self.proxy_process and self.proxy_process.poll() is None
```

### React UI Components

**Main Configuration Form (`webview/components/ConfigForm.tsx`):**
```typescript
import React, { useState, useEffect } from 'react'
import { ModelSelector } from './ModelSelector'
import { PopularModels } from './PopularModels'
import './hive-theme.css'

interface ConfigFormProps {
  config: ClaudeThroneConfig
  onConfigChange: (config: ClaudeThroneConfig) => void
  onStart: () => void
  onStop: () => void
  isRunning: boolean
}

export const ConfigForm: React.FC<ConfigFormProps> = ({
  config, onConfigChange, onStart, onStop, isRunning
}) => {
  const [showApiKey, setShowApiKey] = useState(false)
  
  const providerTooltips = {
    openrouter: "Access 400+ models with smart routing • Get API key: openrouter.ai/keys",
    openai: "GPT-4, GPT-4o, and o1 models • Get API key: platform.openai.com/api-keys", 
    together: "Open source models with fast inference • Get API key: api.together.xyz/settings/api-keys",
    groq: "Ultra-fast inference for open models • Get API key: console.groq.com/keys",
    custom: "Use any OpenAI-compatible endpoint • Enter your custom API base URL"
  }
  
  return (
    <div className="claude-throne-config">
      <div className="hive-header">
        <h2>👑 Claude-Throne Configuration</h2>
        <p className="hive-subtitle">Choose which AI queens will rule your coding kingdom</p>
      </div>
      
      {/* Provider Selection */}
      <div className="config-section">
        <label className="hive-label">AI Provider</label>
        <select 
          value={config.provider} 
          onChange={(e) => onConfigChange({...config, provider: e.target.value as any})}
          className="hive-select"
        >
          <option value="openrouter">🌐 OpenRouter (400+ models)</option>
          <option value="openai">🤖 OpenAI (GPT-4, o1)</option>
          <option value="together">⚡ Together AI (Fast OSS)</option>
          <option value="groq">🚀 Groq (Ultra-fast)</option>
          <option value="custom">🔧 Custom Provider</option>
        </select>
        <div className="hive-tooltip">{providerTooltips[config.provider]}</div>
      </div>
      
      {/* Custom URL for custom provider */}
      {config.provider === 'custom' && (
        <div className="config-section">
          <label className="hive-label">Custom API Base URL</label>
          <input
            type="url"
            value={config.customUrl || ''}
            onChange={(e) => onConfigChange({...config, customUrl: e.target.value})}
            placeholder="https://api.example.com/v1"
            className="hive-input"
          />
        </div>
      )}
      
      {/* Model Selection */}
      <div className="config-section">
        <label className="hive-label">Reasoning Model (Complex Analysis)</label>
        <ModelSelector
          provider={config.provider}
          value={config.reasoningModel}
          onChange={(model) => onConfigChange({...config, reasoningModel: model})}
          modelType="reasoning"
        />
      </div>
      
      <div className="config-section">
        <label className="hive-label">Execution Model (Fast Completion)</label>
        <ModelSelector
          provider={config.provider}
          value={config.executionModel || ''}
          onChange={(model) => onConfigChange({...config, executionModel: model})}
          modelType="execution"
          placeholder="Leave blank to use reasoning model for both"
        />
      </div>
      
      {/* API Key */}
      <div className="config-section">
        <label className="hive-label">API Key</label>
        <div className="api-key-input">
          <input
            type={showApiKey ? "text" : "password"}
            value={config.apiKey}
            onChange={(e) => onConfigChange({...config, apiKey: e.target.value})}
            placeholder="Your API key"
            className="hive-input"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="show-key-btn"
          >
            {showApiKey ? "🙈" : "👁️"}
          </button>
        </div>
        <div className="hive-security-note">
          🔐 Your API keys are stored securely in your system's keychain
        </div>
      </div>
      
      {/* Advanced Options */}
      <div className="config-section advanced-options">
        <details>
          <summary>⚙️ Advanced Settings</summary>
          <div className="advanced-grid">
            <div>
              <label className="hive-label">Proxy Port</label>
              <input
                type="number"
                value={config.port}
                onChange={(e) => onConfigChange({...config, port: parseInt(e.target.value)})}
                min="3000"
                max="9999"
                className="hive-input"
              />
            </div>
            <div>
              <label className="hive-checkbox-label">
                <input
                  type="checkbox"
                  checked={config.debug}
                  onChange={(e) => onConfigChange({...config, debug: e.target.checked})}
                />
                Enable debug logging
              </label>
            </div>
          </div>
        </details>
      </div>
      
      {/* Control Buttons */}
      <div className="control-buttons">
        {isRunning ? (
          <button onClick={onStop} className="hive-button hive-button-danger">
            🛑 Stop Claude-Throne
          </button>
        ) : (
          <button onClick={onStart} className="hive-button hive-button-primary">
            👑 Start Your AI Throne
          </button>
        )}
      </div>
      
      {/* Popular Models Widget */}
      {config.showPopularModels && (
        <PopularModels 
          provider={config.provider}
          onModelSelect={(reasoning, execution) => 
            onConfigChange({...config, reasoningModel: reasoning, executionModel: execution})
          }
        />
      )}
    </div>
  )
}
```

## Phase 3: The Hive Ecosystem Integration

### Branding & Theme (`webview/styles/hive-theme.css`)
```css
:root {
  --hive-gold: #FFD700;
  --hive-dark-gold: #B8860B;
  --hive-bg-dark: #1a1a1a;
  --hive-bg-light: #ffffff;
  --hive-text-primary: #e0e0e0;
  --hive-text-secondary: #b0b0b0;
  --hive-accent: #4CAF50;
  --hive-danger: #f44336;
}

.claude-throne-config {
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: var(--hive-bg-dark);
  color: var(--hive-text-primary);
  border-radius: 8px;
}

.hive-header {
  text-align: center;
  margin-bottom: 30px;
  padding: 20px;
  background: linear-gradient(135deg, var(--hive-gold), var(--hive-dark-gold));
  border-radius: 8px;
  color: #000;
}

.hive-header h2 {
  margin: 0 0 10px 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.hive-subtitle {
  margin: 0;
  opacity: 0.8;
  font-style: italic;
}

.hive-button-primary {
  background: linear-gradient(135deg, var(--hive-gold), var(--hive-dark-gold));
  color: #000;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.hive-button-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.3);
}

.hive-tooltip {
  font-size: 0.85rem;
  color: var(--hive-text-secondary);
  margin-top: 5px;
  padding: 8px;
  background: rgba(255, 215, 0, 0.1);
  border-radius: 4px;
  border-left: 3px solid var(--hive-gold);
}

.hive-security-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--hive-accent);
  margin-top: 5px;
}
```

### Popular Model Pairings (`resources/data/model-pairings.json`)
```json
{
  "featured_pairings": [
    {
      "name": "The Free Genius Combo",
      "reasoning": "deepseek/deepseek-chat-v3.1:free",
      "execution": "qwen/qwen3-coder:free", 
      "description": "World-class reasoning + specialized coding. Perfect balance of intelligence and speed.",
      "cost_tier": "Free",
      "context_total": "128k + 32k",
      "use_cases": ["General development", "Code analysis", "Problem solving"],
      "popularity": 95
    },
    {
      "name": "Gemini Lightning",
      "reasoning": "google/gemini-2.5-pro-preview",
      "execution": "google/gemini-2.5-flash",
      "description": "2M token context window with blazing fast execution. Google's finest.",
      "cost_tier": "Free", 
      "context_total": "2M tokens",
      "use_cases": ["Large codebases", "Document analysis", "Research"],
      "popularity": 88
    },
    {
      "name": "Premium Powerhouse", 
      "reasoning": "openai/o1",
      "execution": "openai/gpt-4o",
      "description": "OpenAI's most advanced reasoning with versatile execution.",
      "cost_tier": "Premium",
      "context_total": "200k tokens",
      "use_cases": ["Complex problems", "Production systems", "Critical analysis"],
      "popularity": 76
    }
  ]
}
```

## Implementation Roadmap

### Week 1: Core Proxy Enhancement
- [ ] Implement `src/key-resolver.js` with smart API key resolution
- [ ] Update `index.js` with enhanced provider detection
- [ ] Add comprehensive error handling and validation
- [ ] Create test scripts for multiple providers
- [ ] Update package.json with The Hive branding

### Week 2: VS Code Extension Foundation  
- [ ] Generate extension scaffold with `yo code`
- [ ] Set up Python backend with FastAPI
- [ ] Implement keyring-based credential storage
- [ ] Create basic WebView panel with React
- [ ] Test extension loading and Python backend communication

### Week 3: UI Development
- [ ] Build ConfigForm component with provider selection
- [ ] Implement ModelSelector with autocomplete
- [ ] Create PopularModels widget with pairings
- [ ] Apply The Hive theme and branding
- [ ] Add status indicators and proxy management

### Week 4: Advanced Features & Polish
- [ ] Model intelligence and suggestions engine
- [ ] Real-time model availability validation
- [ ] Cost estimation and usage tracking
- [ ] Auto-configuration and Claude Code detection
- [ ] Comprehensive testing and documentation

## Success Metrics
- ✅ Fixed custom provider API key authentication
- ✅ Simplified setup from 8+ env vars to GUI clicks
- ✅ Cross-platform secure credential storage
- ✅ The Hive ecosystem brand integration
- ✅ Community adoption and positive feedback

## Launch Strategy
1. **Soft Launch:** The Hive community testing
2. **Documentation:** Comprehensive setup guides
3. **Marketing:** "Choose Your Queen" campaign
4. **Open Source:** MIT license, community contributions
5. **Marketplace:** VS Code extension marketplace

---

*Ready to build the throne that commands all AI models? Let's make Claude Code truly universal! 👑*