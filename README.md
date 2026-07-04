# Math Diagrammer

Generate editable, mathematically accurate geometry diagrams from plain-English prompts.

**Live app:** https://math-diagrammer-luaf.vercel.app *(password protected)*

![Issoceles Triangles example](docs/Issoc.%20Triangles.png)
## The problem

I teach 8th grade Pre-Algebra. Making a clean diagram for a worksheet or assessment — similar triangles with correct proportions, angle marks, congruence ticks — takes 10+ minutes each in GeoGebra or Google Drawings. I needed dozens of them per unit.

This tool does it in about 10 seconds: describe the diagram, get an accurate figure, drag anything that needs adjusting, download a PNG for the worksheet.

## What it does

- **Prompt to diagram** — "two similar triangles ABC and DEF, scale factor 2, equal angles marked" produces a correct figure: exact scale factor, matching arc counts on corresponding angles, matching tick marks on congruent sides
- **Fully editable** — click any shape, mark, or label to drag it, recolor it, relabel it, or delete it
- **Iterate by prompt** — "make DEF twice as big" modifies the existing diagram instead of starting over
- **Export** — PNG (2x resolution) or SVG, ready for worksheets and slides

## How it works

The frontend is a React app that draws shapes as SVG on a canvas and lets you drag and edit them. When you hit Generate, it sends your prompt plus a detailed system prompt (instructions and a JSON format spec) to a serverless function. That function runs on Vercel, holds the API key secretly, and forwards the request to Claude (Anthropic's AI model). Claude returns the diagram as JSON coordinates — numbers describing where every point goes — and the frontend draws them. The password check and API key live server-side so neither can be pulled out of the webpage.

## Stack

- React + Vite
- Vercel (hosting + serverless functions)
- Anthropic API (Claude Sonnet)

## Built with AI-assisted development

I designed this tool around my curriculum needs and built it by directing Claude through the code, then handled the deployment myself: GitHub, Vercel configuration, environment variables, and debugging build and runtime errors until it shipped.

## What I'd add next

- Coordinate plane mode (axes, plotted points) for transformation and slope units
- Saved diagram library so figures persist between sessions