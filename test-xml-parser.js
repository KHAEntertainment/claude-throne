#!/usr/bin/env node
/**
 * Quick test for XML parser to verify it handles different cases correctly
 */

import { parseAssistantMessage } from './xml-tool-parser.js'

console.log('🧪 Testing XML Parser\n')

// Test 1: Text only (no tools)
console.log('Test 1: Text only')
const test1 = parseAssistantMessage("Today's date is 2025-10-23.")
console.log('Input:', "Today's date is 2025-10-23.")
console.log('Output:', JSON.stringify(test1, null, 2))
console.log('✅ Expected: Single text block\n')

// Test 2: Tool only
console.log('Test 2: Tool only')
const test2 = parseAssistantMessage("<Read><file_path>/test.txt</file_path></Read>")
console.log('Input:', "<Read><file_path>/test.txt</file_path></Read>")
console.log('Output:', JSON.stringify(test2, null, 2))
console.log('✅ Expected: Single tool_use block\n')

// Test 3: Text + Tool
console.log('Test 3: Text before tool')
const test3 = parseAssistantMessage("I'll read that file for you.\n<Read><file_path>/test.txt</file_path></Read>")
console.log('Input:', "I'll read that file for you.\\n<Read><file_path>/test.txt</file_path></Read>")
console.log('Output:', JSON.stringify(test3, null, 2))
console.log('✅ Expected: Text block then tool_use block\n')

// Test 4: Text + Tool + Text
console.log('Test 4: Text + Tool + Text')
const test4 = parseAssistantMessage("Let me check.\n<Read><file_path>/test.txt</file_path></Read>\nDone!")
console.log('Input:', "Let me check.\\n<Read><file_path>/test.txt</file_path></Read>\\nDone!")
console.log('Output:', JSON.stringify(test4, null, 2))
console.log('✅ Expected: Text, tool_use, text blocks\n')

// Test 5: Unknown tags (should be treated as text)
console.log('Test 5: Unknown tags')
const test5 = parseAssistantMessage("Some <b>bold</b> text with <Task>unknown</Task> tags")
console.log('Input:', "Some <b>bold</b> text with <Task>unknown</Task> tags")
console.log('Output:', JSON.stringify(test5, null, 2))
console.log('⚠️  Note: <Task> is NOT in KNOWN_TOOLS, so treated as text\n')

// Test 6: Multiple tools
console.log('Test 6: Multiple tools')
const test6 = parseAssistantMessage("First\n<Read><file_path>/a.txt</file_path></Read>\nThen\n<Read><file_path>/b.txt</file_path></Read>\nDone")
console.log('Input:', "First\\n<Read>...</Read>\\nThen\\n<Read>...</Read>\\nDone")
console.log('Output:', JSON.stringify(test6, null, 2))
console.log('✅ Expected: 5 blocks (text, tool, text, tool, text)\n')

console.log('🎉 All tests completed!')
