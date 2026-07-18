// scripts/generate-icon.mjs
//
// Generates the application icon for Windows from an inline SVG.
// Produces:
//   build/icon.ico  — multi-size Windows icon (16/32/48/64/128/256)
//   build/icon.png  — master 256x256 PNG for other uses
//
// Run:  node scripts/generate-icon.mjs
//
// Design: blue gradient background with rounded corners (matching the app's
// --primary palette), big white "AI" lettering center, decorative dots
// top-right (representing "tool collection") and bottom (representing "set").
// Recognizable even at 16x16 because the "AI" silhouette dominates.

import sharp from 'sharp'
import toIco from 'to-ico'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const buildDir = join(projectRoot, 'build')

// Master SVG (256x256 viewBox, scales cleanly)
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
  </defs>

  <!-- Background with rounded corners (app icon standard) -->
  <rect width="256" height="256" rx="56" ry="56" fill="url(#bgGrad)"/>

  <!-- Decorative dots top-right (representing "tool collection") -->
  <circle cx="200" cy="56" r="9" fill="#fbbf24" opacity="0.95"/>
  <circle cx="222" cy="78" r="5" fill="#fbbf24" opacity="0.75"/>
  <circle cx="180" cy="78" r="5" fill="#fbbf24" opacity="0.75"/>

  <!-- Big "AI" lettering (recognizable even at 16x16) -->
  <text x="128" y="172"
        font-family="Arial Black, Helvetica, sans-serif"
        font-size="130"
        font-weight="900"
        fill="#ffffff"
        text-anchor="middle"
        letter-spacing="-6">AI</text>

  <!-- Bottom three dots (representing "set"/multiple tools) -->
  <circle cx="108" cy="222" r="6" fill="#ffffff" opacity="0.65"/>
  <circle cx="128" cy="222" r="6" fill="#ffffff" opacity="0.85"/>
  <circle cx="148" cy="222" r="6" fill="#ffffff" opacity="0.65"/>
</svg>
`

const sizes = [16, 32, 48, 64, 128, 256]

async function main() {
  mkdirSync(buildDir, { recursive: true })

  console.log('Rendering SVG → PNG at sizes:', sizes.join(', '))
  const pngs = []
  for (const size of sizes) {
    const png = await sharp(Buffer.from(svg))
      .resize(size, size, { fit: 'fill' })
      .png()
      .toBuffer()
    pngs.push(png)
  }

  console.log('Bundling PNGs → multi-size ICO...')
  const ico = await toIco(pngs)
  writeFileSync(join(buildDir, 'icon.ico'), ico)

  // Also save a master 256 PNG for non-Windows uses (README badge, etc.)
  writeFileSync(join(buildDir, 'icon.png'), pngs[pngs.length - 1])

  console.log('')
  console.log('✓ Done. Files generated in', buildDir)
  console.log('  - icon.ico (Windows multi-size: 16/32/48/64/128/256)')
  console.log('  - icon.png (master 256x256)')
}

main().catch((err) => {
  console.error('Icon generation failed:', err)
  process.exit(1)
})
