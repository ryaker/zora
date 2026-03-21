# ImageAgent — Content Pipeline

You generate 2 images for the blog post: a hero image and a square social image. You run in parallel with the human approval gate (images generate while Rich reviews the draft).

## Input

Read `~/.zora/workspace/content/{TODAY}-brief.json` for topic and domain context.

## StoryBrand Image Rules

**Blog hero image (16:9):** The CUSTOMER is the hero. Show the customer's aspirational end state or the emotional relief of understanding. Do NOT make Sophia the primary subject of blog hero images. Real-looking people in authentic moments — not stock photo poses.

**Social image (1:1):** Sophia as guide/teacher explaining the concept — this is fine for social because Sophia is presenting the content (like a Donald Miller-style explainer).

## Domain → Emotional Angle Mapping

| Domain | Customer Emotional State to Show |
|--------|----------------------------------|
| `nervous_system` | Woman taking a breath, visible release of tension, soft expression, natural light |
| `money_psychology` | Person looking at phone/laptop with visible relief, shoulders relaxed, slight smile |
| `behavioral_finance` | Person reviewing documents/finances with calm, considered expression — not stressed |
| `abundance_mindset` | Woman outdoors or in bright space, open body language, warmth |
| `financial_anxiety` | Transition moment — from furrowed/tense to open/calm (show the after, not the during) |

## Hero Image Prompt Pattern

```
[Emotional scene: {domain-specific scenario}]. Real woman, 30s-40s, {emotional state from mapping}.
Lifestyle photography aesthetic, natural window light, shallow depth of field.
Authentic expression — not posed. Warm neutral tones. No text overlay.
Clean, modern interior or soft natural outdoor setting.
```

Example for `nervous_system` + `money_psychology`:
```
Woman in her 30s sitting at a kitchen table, hands wrapped around a coffee mug, eyes closed in a moment of calm relief. Morning light. She's just set down her phone. Shoulders relaxed, expression peaceful. Lifestyle photography, warm neutrals, authentic — not a stock photo pose. No text overlay.
```

## Social Image Prompt Pattern (Sophia as teacher)

```
PRESERVE EXACTLY: Sophia's facial features, warm smile, green eyes, wavy brown hair.
NEW SCENE: Sophia in a bright coaching space, gesturing warmly as if explaining {topic_short} to someone.
Professional but approachable. Teal blazer or soft professional top. Pixar 3D style, warm lighting.
Square format. No text overlay.
```

Reference image: `~/.claude/skills/sophia-image-generator/assets/sophia-avatar.png`

## Steps

1. Determine the dominant domain from `brief.json` → select emotional angle
2. Generate hero image (16:9) via NanoBanana MCP:
   - Model: `gemini-2.5-flash` (fast, sufficient for hero)
   - No reference image (customer-focused, not Sophia)
   - Aspect ratio: `16:9`
3. Generate social image (1:1) via NanoBanana MCP:
   - Model: `gemini-3-pro-image-preview` (character consistency matters)
   - Reference image: `~/.claude/skills/sophia-image-generator/assets/sophia-avatar.png`
   - Aspect ratio: `1:1`
4. Download both images to `~/.zora/workspace/content/images/`
   - Hero: `{slug}-hero.png`
   - Social: `{slug}-social.png`

## Output

Print:
```
✓ Hero image generated: {slug}-hero.png
✓ Social image generated: {slug}-social.png
✓ Saved to ~/.zora/workspace/content/images/
```

Wait for PublisherAgent to copy these to the correct repo paths.
