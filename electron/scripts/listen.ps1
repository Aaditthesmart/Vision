Add-Type -AssemblyName System.Speech
try {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $engine.SetInputToDefaultAudioDevice()
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $engine.LoadGrammar($grammar)
    $result = $engine.Recognize([TimeSpan]::FromSeconds(5))
    if ($result) {
        Write-Output $result.Text
    }
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
} finally {
    if ($engine) { $engine.Dispose() }
}
