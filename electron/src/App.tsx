import { VoiceAgent } from "./components/VoiceAgent";

function App() {
  return (
    <div className="w-screen h-screen p-3 bg-transparent flex items-center justify-center font-sans antialiased select-none">
      <div className="w-full h-full max-w-4xl max-h-[700px] flex">
        <VoiceAgent />
      </div>
    </div>
  );
}

export default App;
