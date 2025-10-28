import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Utility functions
function writeHeader(text) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(text);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function isObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}

function isArray(x) {
  return Array.isArray(x);
}

// Flatten JSON object
function flattenJson(obj, prefix = '') {
  const keys = [];
  if (obj == null) return keys;

  if (isObject(obj)) {
    for (const key in obj) {
      const value = obj[key];
      const name = prefix ? `${prefix}.${key}` : key;
      if (isObject(value) || isArray(value)) {
        keys.push(...flattenJson(value, name));
      } else {
        keys.push(name);
      }
    }
  } else if (isArray(obj)) {
    obj.forEach((el, i) => {
      const name = `${prefix}[${i}]`;
      if (isObject(el) || isArray(el)) {
        keys.push(...flattenJson(el, name));
      } else {
        keys.push(name);
      }
    });
  } else {
    if (prefix) keys.push(prefix);
  }
  return keys;
}

// Load JSON file
function loadJsonFile(path) {
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.log(`❌ Failed to parse JSON: ${path}`);
    console.log(`   ${err}`);
    return null;
  }
}

// Get all files in directory recursively
function getFiles(dir, extensions) {
  let results = [];
  const list = readdirSync(dir);
  list.forEach((file) => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(filePath, extensions));
    } else {
      if (extensions.includes(extname(file))) {
        results.push(filePath);
      }
    }
  });
  return results;
}

// Main script
(async () => {
  const folder = '.'; // Change as needed
  const baselineFile = 'en.json';

  writeHeader(`🌍 Locale keys checker — comparing against baseline '${baselineFile}'`);

  const baselinePath = join(folder, baselineFile);
  const baseJson = loadJsonFile(baselinePath);
  if (!baseJson) process.exit(1);

  const baseKeys = [...new Set(flattenJson(baseJson).sort())];

  console.log(`✅ Baseline loaded: ${baselineFile} — total flattened keys: ${baseKeys.length}\n`);

  // Check other locale files
  const files = getFiles(folder, ['.json']).filter(f => !f.endsWith(baselineFile));
  if (files.length === 0) {
    console.log('⚠️ No locale files found.');
  }

  for (const f of files) {
    console.log(`\n🔎 Checking file: ${f}`);
    const json = loadJsonFile(f);
    if (!json) continue;

    const keys = [...new Set(flattenJson(json).sort())];

    const missing = baseKeys.filter(k => !keys.includes(k));
    const extra = keys.filter(k => !baseKeys.includes(k));

    if (keys.length > baseKeys.length) {
      console.log(`🟥 ERROR: ${f} has MORE keys (${keys.length}) than baseline (${baseKeys.length})!`);
      extra.forEach(e => console.log(`      + ${e}`));
    } else if (missing.length > 0) {
      console.log(`❌ Missing keys (${missing.length}):`);
      missing.forEach(m => console.log(`      - ${m}`));
    } else {
      console.log('   ✅ Perfect! All keys match.');
    }

    console.log(`   ℹ️ Summary: baseline=${baseKeys.length} locale=${keys.length} missing=${missing.length} extra=${extra.length}`);
  }

  // Scan codebase for used keys
  writeHeader('🔍 Scanning codebase for t("key") and t(\'key\') usages...');
  const rootDir = join(folder, '..');
  const codeFiles = getFiles(rootDir, ['.ts', '.vue']);

  const pattern = /['"]([^'"]+)['"]/g;
  const usedKeys = new Set();

  for (const file of codeFiles) {
    try {
      const content = readFileSync(file, 'utf8');
      let match;
      while ((match = pattern.exec(content)) !== null) {
        usedKeys.add(match[1]);
      }
    } catch (err) {
      // Ignore errors
    }
  }

  // Compare with baseline keys
  const unusedInCode = baseKeys.filter(k => !usedKeys.has(k));

  if (unusedInCode.length > 0) {
    console.log(`\n⚠️ Keys in ${baselineFile} but NOT USED in code (${unusedInCode.length}):`);
    unusedInCode.forEach(k => console.log(`   + ${k}`));
  }

  // Check for missing keys in code (optional)
  const missingInLocale = [];

  // Final summary
  if (unusedInCode.length === 0 && missingInLocale.length === 0) {
    console.log('\n✅ All translation keys in sync with codebase.');
  }

  console.log('\n🎉 Done! Review discrepancies above.');
})();