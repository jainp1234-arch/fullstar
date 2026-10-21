// Fails if any vendored or generated UI asset listed in libs/ui/assets/manifest.json is missing
// or empty (Plan 2.1). Also checks that the icon codepoints match the manifest's icon list and
// that every illustration has alt text in the strings file. Run: npm run check:assets
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'libs/ui/assets');
const manifest = JSON.parse(readFileSync(join(assets, 'manifest.json'), 'utf8'));
const problems = [];

const required = [
  ...manifest.files.map((file) => file.out),
  ...manifest.generated,
  '../../design-tokens/tokens.css',
  '../strings/en.ts',
  '../styles/fonts.css',
];
for (const relative of required) {
  const path = join(assets, relative);
  if (!existsSync(path)) {
    problems.push(`missing: ${relative}`);
  } else if (statSync(path).size === 0) {
    problems.push(`empty: ${relative}`);
  }
}

const codepointsFile = join(root, 'libs/ui/icons/icon-codepoints.ts');
if (existsSync(codepointsFile)) {
  const generated = [
    ...readFileSync(codepointsFile, 'utf8').matchAll(/^\s+(\w+): 0x[0-9a-f]+,$/gm),
  ].map((m) => m[1]);
  const wanted = [...manifest.icons.names].sort();
  const missingIcons = wanted.filter((name) => !generated.includes(name));
  if (missingIcons.length) {
    problems.push(
      `icons not in the subset font (run make vendor-assets): ${missingIcons.join(', ')}`,
    );
  }
}

const strings = readFileSync(join(root, 'libs/ui/strings/en.ts'), 'utf8');
for (const file of manifest.files.filter((f) => f.key)) {
  if (!strings.includes(`'${file.key}':`) && !strings.includes(`${file.key}:`)) {
    problems.push(`no alt text in libs/ui/strings/en.ts for illustration ${file.key}`);
  }
}

// Lesson scenes may use exactly the vendored illustrations (Schema §5, Plan 4.2)
const lessonSchema = JSON.parse(
  readFileSync(
    join(root, 'services/api/src/main/resources/schemas/lesson.body.schema.json'),
    'utf8',
  ),
);
const sceneKeys = [
  ...lessonSchema.properties.scenes.items.properties.visual.properties.illustration.enum,
].sort();
const vendoredKeys = manifest.files
  .filter((f) => f.key)
  .map((f) => f.key)
  .sort();
if (JSON.stringify(sceneKeys) !== JSON.stringify(vendoredKeys)) {
  problems.push(
    `lesson.body.schema.json illustrations differ from the vendored ones: schema only ${sceneKeys
      .filter((k) => !vendoredKeys.includes(k))
      .join(', ')}; vendored only ${vendoredKeys.filter((k) => !sceneKeys.includes(k)).join(', ')}`,
  );
}
const keysFile = readFileSync(join(root, 'libs/ui/illustrations/illustrations.ts'), 'utf8');
for (const key of vendoredKeys.filter((k) => !k.startsWith('avatar-'))) {
  if (!keysFile.includes(`'${key}',`)) {
    problems.push(`ILLUSTRATION_KEYS in libs/ui/illustrations/illustrations.ts lacks ${key}`);
  }
}

if (problems.length) {
  console.error(`UI assets check failed (${problems.length}):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `UI assets check passed: ${required.length} files, ${manifest.icons.names.length} icons.`,
);
