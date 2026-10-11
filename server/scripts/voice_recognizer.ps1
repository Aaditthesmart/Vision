Add-Type -AssemblyName System.Speech
try {
    $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $rec.SetInputToDefaultAudioDevice()
    $grammar = New-Object System.Speech.Recognition.DictationGrammar
    $rec.LoadGrammar($grammar)
    # Longer initial silence tolerance - wait for user to speak
    $rec.InitialSilenceTimeout = [System.TimeSpan]::FromSeconds(30)
    # Babble timeout - reset if only background noise heard
    $rec.BabbleTimeout = [System.TimeSpan]::FromSeconds(5)
    # End silence - stop capturing after speech goes silent
    $rec.EndSilenceTimeout = [System.TimeSpan]::FromSeconds(1)
    [Console]::WriteLine("READY_FOR_SPEECH")
    [Console]::Out.Flush()

    while ($true) {
        try {
            $result = $rec.Recognize([System.TimeSpan]::FromSeconds(30))
            if ($null -ne $result) {
                $txt = $result.Text
                $conf = $result.Confidence
                if (-not [string]::IsNullOrWhiteSpace($txt)) {
                    [Console]::WriteLine("SPEECH:" + $conf.ToString("F3") + ":" + $txt)
                    [Console]::Out.Flush()
                }
            }
            # Keep looping - never exit while process is alive
        } catch [System.InvalidOperationException] {
            # Timeout with no speech - this is normal, just loop again
            Start-Sleep -Milliseconds 100
        } catch {
            [Console]::WriteLine("ERROR:" + $_.Exception.Message)
            [Console]::Out.Flush()
            Start-Sleep -Milliseconds 500
        }
    }
} catch {
    [Console]::WriteLine("ERROR:" + $_.Exception.Message)
    [Console]::Out.Flush()
}