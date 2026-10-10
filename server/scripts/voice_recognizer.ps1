Add-Type -AssemblyName System.Speech
try {
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $rec.SetInputToDefaultAudioDevice()
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $rec.LoadGrammar($grammar)
    [Console]::WriteLine("READY_FOR_SPEECH")
    [Console]::Out.Flush()
    
    while ($true) {
        $result = $rec.Recognize([System.TimeSpan]::FromSeconds(2))
        if ($null -ne $result) {
            $txt = $result.Text
            $conf = $result.Confidence
            if (-not [string]::IsNullOrWhiteSpace($txt)) {
                [Console]::WriteLine("SPEECH:" + $conf + ":" + $txt)
                [Console]::Out.Flush()
            }
        }
    }
} catch {
    [Console]::WriteLine("ERROR:" + $_.Exception.Message)
    [Console]::Out.Flush()
}