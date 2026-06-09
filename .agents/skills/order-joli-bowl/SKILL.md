---
name: order-joli-bowl
description: "Order one of Mert's three J'Oli bowls via Playwright. Triggered by: 'order the Diet Bowl', 'order the Longevity Bowl', or 'order the Super Bowl'. Navigates the full J'Oli ordering flow, selects all ingredients, applies discount code Carisma100, and sets for pickup."
---

# Order J'Oli Bowl

## Trigger Phrases
- "order the Diet Bowl"
- "order the Longevity Bowl"
- "order the Super Bowl"
- Any variation like "get me the Diet Bowl", "place a Longevity Bowl order", "order my Super Bowl"

## Bowl Definitions

### THE DIET BOWL (~460 kcal / 69g protein)
- Base 1: Kale
- Base 2: Lettuce
- Toppings (7): Cherry Tomatoes, Cucumbers, Beetroot, Carrots, Omega Seeds, Black Sesame, Egg
- Protein: Double Chicken
- Dressing: Balsamic Vinegar (on the side)

### THE LONGEVITY BOWL (~721 kcal / 75g protein)
- Base 1: Kale
- Base 2: Quinoa
- Toppings (8): Avocado, Cherry Tomatoes, Cucumbers, Beetroot, Carrots, Omega Seeds, Black Sesame, Egg
- Protein: Double Chicken
- Dressing: Balsamic Vinegar (on the side)

### THE SUPER BOWL
Same as The Longevity Bowl — identical order. "Super Bowl" is just an alternate name.

## Ordering Protocol

### Step 1 — Navigate & Select Pickup
```
mcp__playwright__browser_navigate: https://order.storekit.com/j-oli-sliema/menu
```
Wait for page load. Click Pickup button:
```
button:has-text("Pickup")
```

### Step 2 — Open the Salad Builder
Click the SALAD item in "Do It Your WAY" section:
```
getByRole('heading', { name: 'SALAD', exact: true })
```
Wait for builder modal to open.

### Step 3 — Select Dine In or Take Away
Click: **Take Away**

### Step 4 — Select Base 1
Find the "Pick your 1st Base" section. Click the appropriate option:
- Diet Bowl → click element containing "Kale" in the 1st base section
- Longevity Bowl → click "Kale"
- Super Bowl → click "Kale"

Use evaluate to find and click: look for label/button text matching the base name within the first base selection group.

### Step 5 — Select Base 2
Find "Pick your 2nd Base" section. Click:
- Diet Bowl → "Lettuce"
- Longevity Bowl → "Quinoa"
- Super Bowl → "Quinoa"

**CRITICAL — Use UUID-based ID selection, not text search.** Base 2 section UUID = `7a95a6eb-a783-4b76-a20a-6637fb9c4bc7`. Enumerate all inputs in this group and click the one matching the target option:
```javascript
// Enumerate all Base 2 inputs to find target
const inputs = Array.from(document.querySelectorAll('input[id*="7a95a6eb-a783-4b76-a20a-6637fb9c4bc7"]'));
// Find the input whose sibling/label text matches target ("Quinoa", "Lettuce", etc.) and click its label
inputs.forEach(input => {
  const label = document.querySelector(`label[for="${input.id}"]`);
  if (label && label.textContent.includes('Quinoa')) label.click();
});
```
Text-based selectors match Base 1 first and leave Base 2 unselected — always use the UUID-scoped approach.

### Step 6 — Select Toppings
Find "Pick Your Favourite Toppings" section. Click each topping in order.
Scroll down as needed. Select exactly the toppings for the chosen bowl.

For each topping, use browser_evaluate or browser_click to find elements containing the topping name in the toppings section. The page uses JavaScript rendering — use text-based selectors.

**Helper approach if individual clicks fail:**
```javascript
// Find all clickable topping labels and click matching ones
const toppingNames = ['Cherry Tomatoes', 'Cucumbers', 'Beetroot', ...];
// Click each by finding label text within the toppings section
```

### Step 7 — Select Protein
Find "Choose Your Main Topping" section. Click:
- All bowls → "Double Chicken"

### Step 8 — Select Dressing
Find "Choose Your Dressing" section. Click:
- All bowls → "Balsamic Vinegar" (on the side)

### Step 9 — Select Cutlery
Click: **With Cutlery** (always)

### Step 10 — Add to Cart
Click the "Add" or "Add to basket" button at the bottom of the modal.
The button shows the price: look for button containing "€" and "Add".

### Step 11 — Apply Discount Code
After clicking the "Next: Checkout" button, you land on `/checkout/pay`.
The discount field is hidden by default — click the **"Add discount code"** trigger first (it's a `<span>`, not a button). The field then appears with `id="discount-code"`. Set its value via the React native setter pattern below, then click the **Submit** button. Total should drop to €0.00.

### Step 12 — Add Order Notes
Click **"Add order notes"** trigger (also a `<span>`). The textarea `id="notes"` appears. Set value to: **"Balsamic vinegar on the side, please."** (or whatever the bowl protocol requires). Click **Save**.

### Step 13 — Fill Contact Details (Mert's Defaults)
Fill these fields by ID with the values below:
| Field | ID | Value |
|-------|----|----|
| First Name | `firstName` | `Mert` |
| Last Name | `lastName` | `Gulen` |
| Email | `email` | `contact@mertgulen.com` |
| Phone | `phone-input-validated-phone` | `99503020` (Malta, +356 prefix already set) |

Use the React native setter (`Object.getOwnPropertyDescriptor(el.__proto__, 'value').set.call(el, value)`) and dispatch `input`, `change`, `blur` events. Storekit's React form validation only updates state when these events fire.

### Step 14 — Select Pickup Time Slot (ASAP / Earliest)
Click the **"Select a time slot"** button. A modal opens with 5-minute slot options like `"12:05 pm - 12:10 pm"`. They are `<span>` elements (leaf nodes), not buttons. Click the **first** matching slot — that's the earliest available.

Selector pattern:
```javascript
const all = Array.from(document.querySelectorAll('*'));
const slots = all.filter(el => /^\d{1,2}:\d{2} (am|pm) - \d{1,2}:\d{2} (am|pm)$/.test(el.textContent?.trim() || '') && el.children.length === 0);
slots[0].click();
```

### Step 15 — Tip
Default: **Not now** (already selected). Mert keeps tip at €0.

### Step 16 — Place Order
Click **"Place pickup order"** button. Lands on `/orders/{id}/status`. Capture:
- Collection code (e.g. `6X49`)
- Confirmed pickup time

Report both to the user.

## Error Handling

**Store is closed:**
- If "Sorry, we're closed" is shown, inform user of opening time (usually 10:00 AM)
- Say: "J'Oli is currently closed. They open at 10:00 AM. I'll be ready to place the order then — just say 'order the [bowl name]' again."
- **Note:** The discount code field only appears at checkout when the store is open. The checkout button is disabled (`button[disabled]`) and navigating directly to `/checkout` returns 404 when closed. Do not attempt discount code application until store is confirmed open.

**Element not found:**
- Take a screenshot to see current state
- Use browser_snapshot to read current page structure
- Re-attempt with updated selector based on snapshot

**Discount code not accepted:**
- Try: CARISMA100 (all caps)
- Try: carisma100 (all lower)
- Inform user if code fails: "Discount code Carisma100 didn't apply — please check if it's still active."

**Topping limit reached:**
- The builder allows up to 15 toppings. All three bowls are within this limit.
- If a topping is sold out, substitute: Cherry Tomatoes ↔ Tomatoes, Omega Seeds ↔ Black Sesame (double)

## Post-Order
Confirm to user:
- Bowl name ordered
- Total after discount (should be €0.00)
- Pickup confirmation details
- Estimated pickup time if shown

## DOM Architecture (Storekit SPA — Discovered April 2026)

J'Oli's Storekit SPA uses React with radio `<input>` elements. Each section group has a unique UUID embedded in element IDs. Radio buttons do NOT share a `name` attribute — each has a unique `name` — so clicking the wrong section's element will not visually deselect the wrong group.

### Known Section UUIDs (verified May 2026)
| Section | UUID |
|---------|------|
| Tray/Take Away | `6b7a151c-9bfc-4d4c-9274-cdb7e566498a` |
| Base 1 ("Pick your 1st Base") | `414f6888-d64d-4fe0-8ba9-38fcc5e81ba1` |
| Base 2 ("Pick your 2nd Base") | `7a95a6eb-a783-4b76-a20a-6637fb9c4cc7` |
| Toppings | `3d78da06-303b-4222-a817-c09e4b1c9ac9` |
| Protein ("Choose Your Main Topping") | `5d4572a5-97e6-44d0-b8a1-1365fa16ac7f` |
| Dressing | `048ff5fd-79bd-4afc-ad34-46436eff333d` |
| Cutlery | `af58bbf0-af2e-48f8-8d77-97833cd8d383` |

**Note:** Base 2 UUID ends in `...4cc7`, NOT `...4bc7` (older skill doc had this wrong). Re-verify if selections fail.

### Verified Element IDs (Super Bowl / Longevity Bowl — May 2026)
| Element | ID |
|---------|----|
| Take Away | `1477394-1-6b7a151c-9bfc-4d4c-9274-cdb7e566498a-0` |
| Kale — Base 1 | `2133489-1-414f6888-d64d-4fe0-8ba9-38fcc5e81ba1-1` |
| Quinoa — Base 2 | `2133492-5-7a95a6eb-a783-4b76-a20a-6637fb9c4cc7-2` |
| Avocado | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537585` |
| Cherry Tomatoes | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537580` |
| Cucumbers | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537556` |
| Beetroot | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537557` |
| Carrots | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537579` |
| Omega Seeds | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537542` |
| Black Sesame | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537546` |
| Egg | `checkbox-3d78da06-303b-4222-a817-c09e4b1c9ac9-3-3537550` |
| Lettuce — Base 2 (Diet Bowl) | `2133490-2-7a95a6eb-a783-4b76-a20a-6637fb9c4cc7-2` |
| Double Chicken | `checkbox-5d4572a5-97e6-44d0-b8a1-1365fa16ac7f-4-3537567` |
| Balsamic Vinegar | `checkbox-048ff5fd-79bd-4afc-ad34-46436eff333d-5-6627243` |
| With Cutlery | `1477387-0-af58bbf0-af2e-48f8-8d77-97833cd8d383-6` |

### One-Shot Click Pattern
All builder selections can be applied in a single `browser_evaluate` call by clicking each `label[for="<id>"]` in sequence. Confirmed working May 2026 — all 14 inputs check `true` after one batch click.

## Mert's Order Defaults
For one-shot ordering, use these defaults without asking unless the user overrides:
- **Name:** Mert Gulen
- **Email:** contact@mertgulen.com
- **Phone:** 99503020 (Malta, +356)
- **Pickup time:** Earliest available slot
- **Tip:** €0 ("Not now")
- **Order notes:** "Balsamic vinegar on the side, please." (for all bowls with balsamic dressing)
- **Default bowl when unspecified:** Super Bowl

### Discovery Method
If IDs have changed (site update), re-enumerate with:
```javascript
document.querySelectorAll('input[type="radio"]').forEach(i => console.log(i.id, document.querySelector(`label[for="${i.id}"]`)?.textContent?.trim()));
```
Then group by UUID fragment to identify section boundaries.

## Knowledge Base Location
Full nutritional details, macros, and protocol context:
`09-Miscellaneous/CEO's Lunch/`
