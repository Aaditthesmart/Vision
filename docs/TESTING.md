# VisionOS — Testing Framework & Benchmark Results

VisionOS features a deterministic test environment and an automated end-to-end test runner to ensure all accessibility behaviors are provably verified.

---

## 1. Deterministic Test Bench (`http://localhost:3001/test-site`)

The local test website simulates realistic e-commerce and documentation scenarios:
- **Audio Catalog**: Product cards with prices (`₹3,499`, `₹1,899`, `₹7,990`) and dynamic price filter dropdown.
- **Accessible Application Form**: Mandatory Name & Email fields, Phone, Accessibility notes, and Submit button.
- **Heading Hierarchy**: H1/H2/H3 structured article on accessibility principles.
- **Edge-Case Triggers**: Dynamic missing promo code button and simulated HTTP 404 alert.

---

## 2. Mandatory Test Scenarios & Automated Results

| Scenario | Objective | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **TEST 1: Page Understanding** | Ask VisionOS to explain the page | Verifies non-empty, grounded summary without reading all navigation links | **PASS** |
| **TEST 2: Goal Navigation** | Find and focus the price filter | DOM focus verification (`document.activeElement === #price-filter`) | **PASS** |
| **TEST 3: Search Discovery** | Locate 2nd product card and summarize | Verifies identification of `boAt Rockerz 450` card and details | **PASS** |
| **TEST 4: Form Assistance** | Fill in Name and Email without submit | Verified DOM input values: `Alex Morgan`, `alex.morgan@test.org`. Verifies form NOT submitted | **PASS** |
| **TEST 5: Failure Recovery** | Request unavailable element | Verifies autonomous recovery loop and honest error explanation | **PASS** |
| **TEST 6: Model Unavailable** | Ollama daemon disconnected | Verifies safe fallback and zero paid cloud API leakage | **PASS** |
| **TEST 7: Approval Gate** | Consequential form submit / checkout | Verifies pipeline pause and explicit user approval modal | **PASS** |
| **TEST 8: Task Cancellation** | Cancel active multi-step task | Verifies immediate cancellation and safe state transition | **PASS** |

---

## 3. Running the Test Suite

```powershell
cd server
npm test
```
