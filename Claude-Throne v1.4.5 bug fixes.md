Claude-Throne v1.4.5 bug fixes. 

1) Model selections need to be tied to providers. If I had set ring-1t and ling-1t from openrouter, then I switch to OpenAI, those models are not going to be available, and I instead should see my last pairing of models from the currently selected provider. 
2) Verify that our anthropic URL detection and proxy bypass methods are working. Currently, custom Provider is set to [https://api.z.ai/api/anthropic](https://api.z.ai/api/anthropic) which is an Anthropic endpoint and as such, does not need the proxy. 
2.b) Filter Models is not working with the custom provider. It should try to retrieve the models from the URL provided and if it cannot, it needs to allow users to enter the model ID's manually instead of just saying "loading" endlessly.
3) Proxy is not working currently. When I send a message, I get back " Unable to connect to API due to poor internet connection"