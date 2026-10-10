/**
 * Test mode demo responses.
 *
 * When the server runs with TEST=true, user messages skip the
 * supervisor/Claude/Browserbase pipeline and instead return the next
 * response sequence from this list.
 *
 * Each response is a sequence of steps — either an "assistant" message
 * (sent to Cartesia TTS and spoken aloud) or a "console" message
 * (shown as an italic log line in the UI, not spoken).
 *
 * Edit the TEST_SEQUENCES array below to script your demo.
 */

export interface TestStep {
  type: "assistant" | "console";
  text: string;
  /** Delay in ms to wait after this step (defaults to sequence delay) */
  delay?: number;
  /** Delay in ms to wait before this step starts (useful for simulating processing before assistant speaks) */
  preDelay?: number;
}

export interface TestSequence {
  /** Default delay in ms between console steps (default: 600) */
  delay?: number;
  steps: TestStep[];
}

export const TEST_SEQUENCES: TestSequence[] = [
  {
    steps: [
      { type: "assistant", text: "Hey Jordan. What's on your mind?" },
    ],
  },
  {
    delay: 800,
    steps: [
      { type: "assistant", text: "<emotion value=sympathetic />Oh no! Give me a sec, let me see what we should be looking for."},
      { type: "console", text: "LangGraph supervisor calls commerce agent\n" + JSON.stringify({ current_task: "Order amazon items for food poisoning.", context_window: [
        { role: "user", content: "I have food poisoning, order stuff off amazon to help." },
      ], elastic_hits: [] }), delay: 2000},
      { type: "console", text: "Commerce agent calls Stagehand navigate tool\n" + JSON.stringify({ url: "https://www.amazon.com/" }), delay: 2000 },
      { type: "console", text: "Commerce agent calls Perplexity Sonar tool\n" + JSON.stringify({ query: "Best amazon items for food poisoning." }), delay: 2000 },
      { type: "assistant", text: "Okay. After some research, I'd recommend bland foods, electrolyte drinks, or just some medicine. Which one would you like?" },
    ],
  },
  {
    delay: 500,
    steps: [
      { type: "assistant", text: "[laughter] Yeah that makes sense. Alright let's see what medicine we can get you.", delay:2000, preDelay:1000 },
      { type: "console", text: "LangGraph supervisor calls commerce agent\n" + JSON.stringify({ current_task: "Find safe medicine for food poisoning.", context_window: [
        { role: "user", content: "Food poisoning, order stuff off amazon." },
        { role: "assistant", content: "Bland foods, electrolyte drinks, or medicine?" },
        { role: "user", content: "Medicine." },
      ], elastic_hits: [] }), delay: 2000 },
      { type: "console", text: "Commerce agent calls Elasticsearch tool\n" + JSON.stringify({ query: "What medical allergies do I have?" }), delay: 2000 },
      { type: "console", text: "Commerce agent calls Perplexity Sonar tool\n" + JSON.stringify({ query: "Food poisoning medicine to avoid if allergic to Aspirin." }), delay: 2000 },
      { type: "assistant", text: "Since you're allergic to Aspirin, I'll make sure to avoid Pepto-Bismol and similar medicines. Let me search for some safe options.", delay: 6000 },
      { type: "console", text: "Commerce agent calls Stagehand act tool\n" + JSON.stringify({ instruction: "Search for food poisoning medicines" }), delay: 2000 },
      { type: "console", text: "Commerce agent calls Stagehand observe tool\n" + JSON.stringify({ instruction: "List non-Pepto-Bismol food poisoning medicines" }), delay: 2000 },
      { type: "assistant", text: "I found a few options. Let me list them out for you. There's Bismuth subsalicylate, which is anti-diarrhea and helps inflammation. Or, there's Arsenicum, which helps with nausea, vomiting, and diarrhea." },
    ],
  },
  // {
  //   delay: 1000,
  //   steps: [
  //     { type: "console", text: "LangGraph supervisor calls commerce agent\n" + JSON.stringify({ current_task: "Search Amazon for safe food poisoning meds.", context_window: [
  //       { role: "assistant", content: "Bland foods, electrolyte drinks, or medicine?" },
  //       { role: "user", content: "Medicine." },
  //       { role: "assistant", content: "Allergic to Aspirin, avoiding Pepto-Bismol. Searching safe options." },
  //     ], elastic_hits: [{ field: "medical_allergies", value: "Aspirin" }] }), delay: 2000 },
  //     { type: "console", text: "Commerce agent calls Stagehand act tool\n" + JSON.stringify({ instruction: "Search for food poisoning medicines" }), delay: 2000 },
  //     { type: "console", text: "Commerce agent calls Stagehand observe tool\n" + JSON.stringify({ instruction: "List non-Pepto-Bismol food poisoning medicines" }), delay: 2000 },
  //     { type: "assistant", text: "I found a few options. The top one is Arsenicum Album, a homeopathic remedy for nausea, vomiting, and diarrhea." },
  //   ],
  // },
  {
    delay: 1000,
    steps: [
      { type: "assistant", text: "Alright! Let me find the best one." },
      { type: "console", text: "LangGraph supervisor calls commerce agent\n" + JSON.stringify({ current_task: "Find best Arsenicum option on Amazon.", context_window: [
        { role: "user", content: "Medicine." },
        { role: "assistant", content: "Avoiding Pepto-Bismol. Searching safe options." },
        { role: "assistant", content: "Top option: Arsenicum Album for nausea/vomiting/diarrhea." },
        { role: "user", content: "Tell me more about that one." },
      ], elastic_hits: [{ field: "medical_allergies", value: "Aspirin" }] }), delay: 2000 },
      { type: "console", text: "Commerce agent calls Stagehand observe tool\n" + JSON.stringify({ instruction: "Observe the best Arsenicum option." }), delay: 2000 },
      { type: "assistant", text: "Amazon's best option is Boiron Arsenicum Album 30C Homeopathic Medicine for Relief from Diarrhea, Nausea, Vomiting, and Cramps. 240 count at 15 dollars and 60 cents, with a 4.8 star rating and 781 reviews." },
    ],
  },
  {
    delay: 1000,
    steps: [
      { type: "assistant", text: "<emotion value=enthusiastic />Cool! I'll go ahead and purchase the Boiron Arsenicum." },
      { type: "console", text: "LangGraph supervisor calls commerce agent\n" + JSON.stringify({ current_task: "Purchase Boiron Arsenicum on Amazon.", context_window: [
        { role: "assistant", content: "Top option: Arsenicum Album." },
        { role: "user", content: "Tell me more." },
        { role: "assistant", content: "Boiron Arsenicum 30C, 240ct, $15.60, 4.8 stars." },
        { role: "user", content: "Buy that one." },
      ], elastic_hits: [{ field: "medical_allergies", value: "Aspirin" }] }), delay: 2000 },
      { type: "console", text: "Commerce agent calls Stagehand act tool\n" + JSON.stringify({ instruction: "Purchase the Boiron Arsenicum Album 30C - 3 Count (240 Pellets)" }), delay: 2000 },
    ],
  },
];

let sequenceIndex = 0;

/**
 * Returns the next test sequence in order, cycling back to the
 * beginning when we reach the end.
 */
export function getNextSequence(): TestSequence {
  const sequence = TEST_SEQUENCES[sequenceIndex % TEST_SEQUENCES.length];
  sequenceIndex++;
  return sequence;
}

/**
 * Reset the sequence index back to the start (useful per-connection).
 */
export function resetResponses(): void {
  sequenceIndex = 0;
}
