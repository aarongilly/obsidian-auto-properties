// No imports at all — require everything manually
test('step by step loading', () => {
  jest.resetModules()
  
  // First load obsidian mock manually
  const obsidian = require('obsidian')
  console.log('obsidian PluginSettingTab:', typeof obsidian.PluginSettingTab)
  
  // Now try settings
  const settings = require('../settings')
  console.log('after require, settings type:', typeof settings)
  console.log('settings keys:', Object.keys(settings))
  console.log('flattenRule:', typeof settings.flattenRule)
})
