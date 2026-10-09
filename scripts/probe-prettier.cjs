/* Development helper: prints the options and defaults of the bundled Prettier and its plugins. */
(async () => {
  const prettier = require('prettier');
  const java = (await import('prettier-plugin-java')).default;
  const xml = (await import('@prettier/plugin-xml')).default;
  const toml = (await import('prettier-plugin-toml')).default;
  console.log('prettier', prettier.version);
  const info = await prettier.getSupportInfo({ plugins: [java, xml, toml] });
  for (const option of info.options) {
    console.log(option.name, JSON.stringify(option.default), JSON.stringify(option.choices?.map((choice) => choice.value)));
  }
  console.log('java defaults', JSON.stringify(java.defaultOptions));
  console.log('xml defaults', JSON.stringify(xml.defaultOptions));
  console.log('toml defaults', JSON.stringify(toml.defaultOptions));
})();
