# Commerce Agent — Shopping & Checkout Flows

> The shopper. Handles product search, comparison, cart management, budget tracking, and checkout — the full e-commerce lifecycle for the Visa $10k prize track.

---

## Responsibilities

1. Product search and discovery on e-commerce sites (Amazon, etc.)
2. Structured data extraction (price, rating, availability, features)
3. Product comparison and recommendation
4. Cart management (add, remove, view, validate totals)
5. Budget checking against user-set spending limits
6. Full checkout flow (address, payment, confirmation)
7. Coupon/discount detection and application

---

## I/O Contract

```typescript
// ── INPUT (from LangGraph state, set by Supervisor) ──────────
interface CommerceAgentInput {
  intent: { category: "commerce"; subIntent: string; entities: Record<string, string>; };
  stagehand: StagehandInstance;          // Browser control (via ExecutionContext only)
  userProfile: UserProfile;              // Budget, shipping address
  conversationHistory: ConversationMessage[];
  onAction: (action: { description: string; agent: "commerce" }) => void;
  abortSignal: AbortSignal;
}

// ── OUTPUT (partial LangGraph state update) ──────────────────
interface CommerceAgentOutput {
  agentResponse: string;         // Plain English speech text (no markdown)
  suggestedActions: string[];    // Voice menu: ["Checkout", "Keep shopping", ...]
  browserActions: BrowserAction[]; // Log of actions taken
}
```

**Rules:**
- MUST NOT interact with Socket.io or produce audio — returns text only.
- MUST check budget BEFORE add-to-cart and WARN if over limit.
- MUST NOT auto-confirm checkout — always ask the user first.
- On error, return a speakable `agentResponse` describing the failure — never throw.

---

## Sub-Intents

The supervisor routes to this agent with a classified sub-intent:

| Sub-Intent | Description | Example Utterance |
|------------|-------------|-------------------|
| `product_search` | Search for products matching criteria | "Find headphones under $200" |
| `product_detail` | Get details on a specific product | "Tell me more about the Sony ones" |
| `product_compare` | Compare multiple products | "Compare the top 3" |
| `add_to_cart` | Add a product to cart | "Add the Sony to my cart" |
| `view_cart` | View current cart contents | "What's in my cart?" |
| `remove_from_cart` | Remove item from cart | "Remove the headphones" |
| `checkout` | Start checkout flow | "Checkout" / "Buy now" |
| `budget_check` | Check remaining budget | "How much can I still spend?" |

---

## Agent Node Implementation

```typescript
async function commerceAgentNode(state: typeof AgentState.State) {
  const { intent, stagehand, userProfile, conversationHistory, onAction, abortSignal } = state;

  // Get commerce-specific session state
  const commerceState = getCommerceState(state);

  switch (intent.subIntent) {
    case "product_search":
      return await handleProductSearch(intent.entities, stagehand, commerceState, onAction, abortSignal);

    case "product_detail":
      return await handleProductDetail(intent.entities, stagehand, commerceState, onAction, abortSignal);

    case "add_to_cart":
      return await handleAddToCart(intent.entities, stagehand, commerceState, userProfile, onAction, abortSignal);

    case "checkout":
      return await handleCheckout(stagehand, commerceState, userProfile, onAction, abortSignal);

    default:
      return await handleGenericCommerce(state);
  }
}
```

---

## Handler: Product Search

```typescript
import { z } from "zod";

const ProductSchema = z.object({
  name: z.string(),
  price: z.number(),
  currency: z.string(),
  rating: z.number().optional(),
  reviewCount: z.number().optional(),
  availability: z.string().optional(),
  url: z.string().optional(),
  imageAlt: z.string().optional(), // Accessible image description
});

const SearchResultsSchema = z.object({
  products: z.array(ProductSchema),
  totalResults: z.number().optional(),
  currentPage: z.number().optional(),
});

async function handleProductSearch(
  entities: Record<string, string>,
  stagehand: StagehandInstance,
  commerceState: CommerceState,
  onAction: ActionCallback,
  signal: AbortSignal,
) {
  const { product, budget, store } = entities;
  const targetStore = store || "amazon.com";
  const maxPrice = budget ? parseFloat(budget.replace(/[^0-9.]/g, "")) : undefined;

  // Step 1: Navigate to store
  onAction({ description: `Navigating to ${targetStore}`, agent: "commerce" });
  await stagehand.page.goto(`https://www.${targetStore}`);

  // Step 2: Search for product
  onAction({ description: `Searching for "${product}"`, agent: "commerce" });
  await stagehand.act({ action: `search for "${product}"` });

  // Step 3: Apply price filter if budget specified
  if (maxPrice) {
    onAction({ description: `Filtering results under $${maxPrice}`, agent: "commerce" });
    await stagehand.act({ action: `filter results by price under $${maxPrice}` });
  }

  // Step 4: Extract product data
  onAction({ description: "Extracting product information", agent: "commerce" });
  const results = await stagehand.extract({
    instruction: "Extract the top 5 product results with name, price, rating, and review count",
    schema: SearchResultsSchema,
  });

  // Step 5: Filter by budget and rank
  let products = results.products;
  if (maxPrice) {
    products = products.filter(p => p.price <= maxPrice);
  }
  products.sort((a, b) => (b.rating || 0) - (a.rating || 0));

  // Step 6: Store results in commerce state for follow-up references
  commerceState.lastSearchResults = products;
  commerceState.currentStore = targetStore;

  // Step 7: Format spoken response
  const top3 = products.slice(0, 3);
  const responseLines = top3.map((p, i) =>
    `${i + 1}. ${p.name}, $${p.price}${p.rating ? `, ${p.rating} stars` : ""}`
  );

  return {
    agentResponse: `I found ${products.length} results. Here are the top ${top3.length}: ${responseLines.join(". ")}. Which one interests you, or would you like me to search differently?`,
    suggestedActions: [
      ...top3.map(p => `Tell me about ${p.name.split(" ").slice(0, 3).join(" ")}`),
      "Add the first one to cart",
      "Search for something else",
    ],
    browserActions: [{ type: "navigate", target: targetStore }, { type: "search", query: product }],
  };
}
```

---

## Handler: Add to Cart

```typescript
async function handleAddToCart(
  entities: Record<string, string>,
  stagehand: StagehandInstance,
  commerceState: CommerceState,
  userProfile: UserProfile,
  onAction: ActionCallback,
  signal: AbortSignal,
) {
  const { product } = entities;

  // Resolve product reference ("the Sony ones", "the first one", "it")
  const resolvedProduct = resolveProductReference(product, commerceState);

  if (!resolvedProduct) {
    return {
      agentResponse: "I'm not sure which product you mean. Could you be more specific?",
      suggestedActions: commerceState.lastSearchResults?.map(p => `Add ${p.name}`) || [],
    };
  }

  // Budget check BEFORE adding
  const budgetRemaining = userProfile.budget?.monthly_otc
    ? userProfile.budget.monthly_otc - commerceState.cartTotal
    : Infinity;

  if (resolvedProduct.price > budgetRemaining) {
    return {
      agentResponse: `That would put you over your monthly budget. ${resolvedProduct.name} costs $${resolvedProduct.price}, but you only have $${budgetRemaining.toFixed(2)} remaining. Want me to find a cheaper alternative?`,
      suggestedActions: ["Find cheaper alternative", "Add it anyway", "Check my budget"],
    };
  }

  // Navigate to product and add to cart
  onAction({ description: `Adding ${resolvedProduct.name} to cart`, agent: "commerce" });

  if (resolvedProduct.url) {
    await stagehand.page.goto(resolvedProduct.url);
  }

  await stagehand.act({ action: `click "Add to Cart" button` });

  // Update commerce state
  commerceState.cart.push({
    name: resolvedProduct.name,
    price: resolvedProduct.price,
    quantity: 1,
  });
  commerceState.cartTotal += resolvedProduct.price;

  const newBudgetRemaining = budgetRemaining - resolvedProduct.price;

  return {
    agentResponse: `Added ${resolvedProduct.name} to your cart. Your cart total is $${commerceState.cartTotal.toFixed(2)}. You have $${newBudgetRemaining.toFixed(2)} remaining in your budget. Would you like to checkout or keep shopping?`,
    suggestedActions: ["Checkout", "View my cart", "Keep shopping"],
  };
}
```

---

## Handler: Checkout Flow

```typescript
async function handleCheckout(
  stagehand: StagehandInstance,
  commerceState: CommerceState,
  userProfile: UserProfile,
  onAction: ActionCallback,
  signal: AbortSignal,
) {
  if (commerceState.cart.length === 0) {
    return {
      agentResponse: "Your cart is empty. Would you like to search for something?",
      suggestedActions: ["Search for products"],
    };
  }

  // Step 1: Navigate to cart/checkout
  onAction({ description: "Going to checkout", agent: "commerce" });
  await stagehand.act({ action: "go to cart and proceed to checkout" });

  // Step 2: Fill shipping information (from user profile if available)
  if (userProfile.shippingAddress) {
    onAction({ description: "Filling shipping information", agent: "commerce" });
    await stagehand.act({
      action: `Fill the shipping form with:
        Name: ${userProfile.shippingAddress.name}
        Address: ${userProfile.shippingAddress.address}
        City: ${userProfile.shippingAddress.city}
        State: ${userProfile.shippingAddress.state}
        Zip: ${userProfile.shippingAddress.zip}`
    });
  }

  // Step 3: Verify totals
  onAction({ description: "Verifying order total", agent: "commerce" });
  const orderSummary = await stagehand.extract({
    instruction: "Extract the order summary: subtotal, shipping, tax, and total",
    schema: z.object({
      subtotal: z.number(),
      shipping: z.number(),
      tax: z.number(),
      total: z.number(),
    }),
  });

  // Step 4: Check for coupons/discounts
  const discounts = await stagehand.extract({
    instruction: "Check if there are any coupon codes or discounts available on the page",
    schema: z.object({
      couponsAvailable: z.boolean(),
      couponCodes: z.array(z.string()).optional(),
    }),
  });

  let discountNote = "";
  if (discounts.couponsAvailable && discounts.couponCodes?.length) {
    discountNote = ` I also found a coupon code: ${discounts.couponCodes[0]}. Want me to apply it?`;
  }

  // DO NOT auto-confirm. Always ask user.
  return {
    agentResponse: `Your order summary: subtotal $${orderSummary.subtotal}, shipping $${orderSummary.shipping}, tax $${orderSummary.tax}, total $${orderSummary.total}.${discountNote} Should I confirm the order?`,
    suggestedActions: [
      "Confirm order",
      discounts.couponsAvailable ? "Apply coupon first" : null,
      "Go back to shopping",
    ].filter(Boolean),
  };
}
```

---

## Product Reference Resolution

Users refer to products loosely: "the Sony ones", "the first one", "add it", "the cheaper one". The agent must resolve these against the current commerce state.

```typescript
function resolveProductReference(
  reference: string,
  commerceState: CommerceState,
): Product | null {
  const products = commerceState.lastSearchResults || [];
  const ref = reference.toLowerCase();

  // Ordinal references: "the first one", "number 2", "the third"
  const ordinalMap: Record<string, number> = {
    first: 0, "1": 0, one: 0,
    second: 1, "2": 1, two: 1,
    third: 2, "3": 2, three: 2,
  };
  for (const [key, index] of Object.entries(ordinalMap)) {
    if (ref.includes(key) && products[index]) return products[index];
  }

  // Pronoun references: "it", "that one" → last mentioned product
  if (["it", "that", "that one", "this one"].some(p => ref.includes(p))) {
    return commerceState.lastMentionedProduct || products[0];
  }

  // Brand/name matching: "the Sony", "the Bose one"
  const match = products.find(p => p.name.toLowerCase().includes(ref));
  if (match) return match;

  // Price-based: "the cheaper one", "the expensive one"
  if (ref.includes("cheap") || ref.includes("less expensive")) {
    return [...products].sort((a, b) => a.price - b.price)[0];
  }
  if (ref.includes("expensive") || ref.includes("pricier")) {
    return [...products].sort((a, b) => b.price - a.price)[0];
  }

  return null;
}
```

---

## Commerce State

```typescript
interface CommerceState {
  cart: CartItem[];
  cartTotal: number;
  currentStore: string | null;
  lastSearchResults: Product[] | null;
  lastMentionedProduct: Product | null;
  checkoutStage: "idle" | "cart" | "shipping" | "payment" | "confirmation";
}

interface CartItem {
  name: string;
  price: number;
  quantity: number;
  url?: string;
}
```

---

## Interaction with Other Layers

| Layer | Interaction | Details |
|-------|-------------|---------|
| **LangGraph Supervisor** | Receives routed intent | Called as a graph node with intent + entities |
| **Execution Layer (Stagehand)** | All browser interactions | `act()`, `extract()`, `agent()` for DOM manipulation |
| **Knowledge Base** | User profile for budget, address | Read-only access to budget limits, shipping info |
| **General Agent** | Cross-referencing during handoff | If user asks "is this safe?", supervisor routes to General Agent which handles health queries with user profile context |
| **Server Layer** | Streams actions via callback | `onAction()` fires for each browser step |

---

## Stagehand Usage Patterns

| Method | Use Case |
|--------|----------|
| `stagehand.act()` | Click buttons, fill forms, navigate ("add to cart", "search for X") |
| `stagehand.extract()` | Pull structured data (product listings, prices, cart totals) |
| `stagehand.agent()` | Complex multi-step tasks (full checkout flow as fallback) |
| `stagehand.observe()` | Discover available actions on a page (what can I do here?) |
| `stagehand.page.goto()` | Direct URL navigation |

---

## Error Recovery

```
Scenario: "Add to Cart" button not found
  → Retry with stagehand.observe() to find alternative actions
  → Try: "Buy Now", "Add to Basket", "Purchase"
  → If all fail: report to user, suggest trying a different product

Scenario: Price changed between search and cart
  → Extract new price, compare with budget
  → Inform user: "The price changed to $X since I last checked. Still want to add it?"

Scenario: Out of stock
  → Detect via extract() or act() failure
  → Report: "This item is currently out of stock. Want me to find similar products?"
```
