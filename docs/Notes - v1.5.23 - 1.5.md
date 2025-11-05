Notes - v1.5.23 - 1.5.55
--------------------------------
Debug Issues - High Priority:

1) Openrouter Models still have inconsistent performance. Some models manage to show full output. Others show truncated output or portions of their reasoning/chain-of-thought instead of the true reply. Tool usage varies by model as well. Even models that generally excel at tool usage have trouble here. 
2) 
Short example session
'''
 /model opusplan 
  ⎿ Set model to opusplan (inclusionai/ring-1t)


> give me a 1 paragraph summary of this 
project based on the readme 

⏺ Search(pattern: "**/README*")
  ⎿  Found 100 files (ctrl+o to expand)

⏺ Read(README.md)
  ⎿  Read 239 lines

> continue 

> /model 
  ⎿ Set model to haiku 
    (anthropic/claude-haiku-4.5)

> continue please 

⏺ Based on the README, here's a 1-paragraph
   summary of the Claude-Throne project:

  Thronekeeper (formerly Claude-Throne) is
  a sophisticated AI model routing

> what MCP servers are currently installed?
 

⏺ listMcpResources(List all MCP resources)
  ⎿  [                                    
       {
         "name": "Beads Quickstart Guide",
     … +14 lines (ctrl+o to expand)

> /model 
  ⎿ Set model to Default (Sonnet 4.5 · Smartest
     model for daily use)

> /model 
  ⎿  Set model to opus (inclusionai/ring-1t)

> look over the readme and docs folder and 
give me a 2 paragraph overview of this 
project 

⏺ Based on the README and documentation,
  here's a 2-paragraph overview of the
  Claude-Throne project:

  Thronekeeper (formerly Claude-Throne) is
  a sophisticated evolution of the
  anthropic-proxy project that provides
  universal AI model routing through a
  unified Anthropic-compatible API.
  Originally forked from Max Nowack's
  anthropic-proxy, it has significantly
  diverged in architecture and scope while
  maintaining the core concept of
  translating Anthropic API requests to
  OpenAI-compatible formats. The project
  functions as a comprehensive ecosystem
  centered around a VS Code extension that
  enables developers to access multiple AI
  providers—including OpenRouter (400+
  models), OpenAI, Together AI, Deepseek,
  GLM (Z.AI), and custom endpoints—through
  a single interface. Unlike the original
  CLI-focused proxy, Claude-Throne features
   a modern React webview panel, secure
  credential management via VS Code secrets
   and an optional Python backend, and
  intelligent provider detection that
  automatically routes requests to
  appropriate endpoints.

  The system comprises three main
  architectural components: a Node.js
  Fastify proxy server that handles API
  translation and key resolution, a
  feature-rich VS Code extension for
  configuration and management, and a
  Python backend (ct_secretsd) for enhanced
   security and credential storage. Key
  capabilities include two-model mode for
  separating reasoning and execution
  models, direct Anthropic-native
  connections for Deepseek and GLM
  providers (bypassing the proxy),
  comprehensive testing coverage, and
  automatic configuration of Claude Code
  settings. Production-ready at version
  1.5.17, the project offers model
  selection best practices,
  provider-specific recommendations, and
  balances performance with quality through
   various model pairing strategies. While
  originally inspired by anthropic-proxy,
  Claude-Throne has evolved into an
  independent solution with enhanced
  security, better developer experience,
  and expanded provider support that
  maintains MIT licensing while
  acknowledging its origins.
'''

 - They are also unable to see MCP tools, despite the /mcp command showing MCP's being installed and available. When I asked the model to list the MCP's it instead returned a CLI tool/plugin that's not even setup as an MCP server.

'''
⏺ listMcpResources(List all MCP resources)
⎿  [                                    
     {
       "name": "Beads Quickstart Guide",
   … +14 lines (ctrl+o to expand)

⏺ listMcpResources(List MCP resources from
                server "core-memory")
⎿  (No resources found)                 

⏺ listMcpResources(List MCP resources from
                server
                "filesystem-with-morph")
⎿  (No resources found)                 

⏺ listMcpResources(List MCP resources from
                server "deepwiki")
⎿  (No resources found)
'''

We've been chasing these tool issues for a while now to no avail. There's an issue on it we marked as solved but obviously it's not. [Issue #2](https://github.com/KHAEntertainment/thronekeeper/issues/2)
We might've solved an aspect of it, but we're definitely not done with it.  

This proxy project which is specifically intended for use with openrouter in claude-code might have some valuable information for you to use in your research. Use deepwiki ask_question to describe the issues we're having and see how claude-code router (CCR) handles it.
[claude-code-router](https://github.com/musistudio/claude-code-router)

3) Manual Model Entry Failure
When a provider is selected and the model list doesn't auto populate, the form to manually create models is shown. When you do this, you get a "model saved successfully" message but the model does not show up in the list or anywhere else to actually select for that provider. 

4) Custom Anthropic Providers may still be glitchy in Webview Panel. 
I added another custom provider with an anthropic style API Endpoint and while Moonshot/Kimi is working to list models, the new one, Minimax, is not. After I save the provider and set it up with a proper API key it displays "Failed to load models: Error: Model list failed (404): 404 page not found" which then leads to the manual models not being saved error mentioned above. BE VERY CAREFUL WITH THESE MODIFICATIONS! These are the types of refactors we did in the past that broke long-standing, working functions in the process of resolving the issue at hand. That cannot happen again. Be meticulous. Be surgical. Follow all guardrails and consitution. 

_RESOLVED (v1.5.23.1): The bypass logic in `PanelViewProvider.handleListModels` treated every Anthropic-style endpoint as native and returned the hardcoded Claude 3.5 Sonnet model. The bypass now only applies to built-in Deepseek/GLM providers, so custom providers like Minimax fetch their own model lists. Added logging to surface the resolved models endpoint and improved 404 messaging._

5) "Two-Model" function is still listed in several areas but we switched from two model to three-model many versions ago, so that older terminology is confusing and should be updated. 

  -------------------------------------
  Webview Panel:

  - Save Model Combo is still not working the way it's intended. Each Provider should be able to save MORE THAN ONE combo! As you save model combos, they should show up in the Popular Combos section, and be selectable from there. We can rename that section to "Quick Combos" to better reflect its purpose. That section can update itself as you switch providers OR be provider agnostic in terms of displaying them all together, BUT when you select a combo it will switch the system to the correct provider from which the combo was saved. 
    - The current "Popular Combos" section gives a name to the Combo, like "The Free Genius Combo", so our save function should also allow us to NAME the saved combos we create. Hovering over a combo shows you the provider and the models in the combo.

  - Filter Models List
    - Next to "Filter Models" title, put the selected provider in parentheses, so for instance "Filter Models (OpenRouter)"
    - As you select your models, move the selected models to the top of the list. In the instance you want the same model for 2 roles, adjust accordingly (it currently lets you do this, but make sure the logic carries over when setting the function to move the selections to the top)  

  - Next to the Settings Gear icon in the bottom left corner of the webview panel, add the version number of the extension for quick reference.   
  - When displayed in a single column, like left or right panel instead of the bottom terminal panel where it can expand to a 2 column view, the filter models panel should have a capped height so the user can still get to the "Advanced" section below it without having to scroll through 200+ openrouter models. Maybe 250px height for the scrollable area. 


 -------------------------------------

 VSCode/Cursor settings page:

 - Settings page is overall outdated. Many of the entries still say "Claude Throne" instead of "Thronekeeper" and I don't mean the underlying functions, I know those are staying as claude-throne, but the labels need to be updated.
 - Many of these settings are redundant as they now exist in the webview panel. We should remove the ones that are not needed here anymore. 
   - For Example: In the webview panel, I have the port set to 3615 which is what it's using. In this old settings page it's still set to 3000. Confusing and redundant. Also refers to "Two Model Mode" which we changed many versions ago to Three model mode. 
 - Whatever DOES remain on this page should be grouped together accordingly, it's currently very sporadic as it was likely just thrown together piecemeal over time and then left to fester as we moved things to the webview panel. 
  
-------------------------------------

New Functionality:

 - Under Model Selection, "Use separate models for different task types (Reasoning/Coding/Value)" let's add a new sub-function that shows up only when that is checked. 
    - The sub-function should be "Enable OpusPlan Mode" which automatically sets "ANTHROPIC_MODEL": "opusplan" which tells the system to automatically use Opus for planning and Sonnet for completion. But in our case, it'll automatically set the models we chose for Opus and Sonnet alternatives to operate in the same manner.

--------------------------------------  
Qualitative Improvements:

 - These are additional CLAUDE ENV configs that can be included in settings.json that I have seen some providers specify to use when setting up claude-code with their models. 

 '''
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
 '''   

-------------------------------------

Roadmap
- This is just planning for future functions and we will update the Readme.md to reflect it. We are NOT implementing these right now, just listing them as features coming soon

  ##Roadmap Items
  - Multiple Provider Support, set your Reasoning, Coding and Value (Opus, Sonnet, Haiku) models to different providers. Example:
  '''
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3616",
    "ANTHROPIC_MODEL": "opusplan",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "openai/gpt-5-codex",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "zai/glm-4.6",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "mistral/codestral"
  }
}
'''
  - Letta API Support - Use Letta Agents inside Claude-Code
  - Abacus.AI/ChatLLM Support - Use ChatLLM's "RouteLLM" model to automatically route your messages/tasks to the most relevant SOTA model to fulfill it for a single monthly fee instead of traditional API credits.
  - oAuth Authentication for OpenAI Codex, Gemini and Qwen Code, allowing you to leverage your monthly subscription plans for those agents instead of traditional API credits.
