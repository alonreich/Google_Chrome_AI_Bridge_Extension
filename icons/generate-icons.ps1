# Realistic elliptical camera-eye icons — minimal padding, max visible size.
Add-Type -AssemblyName System.Drawing

function New-EllipsePath {
    param([float]$X, [float]$Y, [float]$W, [float]$H)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($X, $Y, $W, $H)
    return $path
}

function Save-HumanEyeIcon {
    param(
        [string]$Path,
        [int]$Size,
        [string]$State  # off | on | active
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    switch ($State) {
        'off' {
            $bg = [System.Drawing.Color]::FromArgb(255, 22, 24, 28)
            $sclera = [System.Drawing.Color]::FromArgb(255, 218, 220, 224)
            $scleraShade = [System.Drawing.Color]::FromArgb(255, 185, 188, 194)
            $irisA = [System.Drawing.Color]::FromArgb(255, 100, 118, 145)
            $irisB = [System.Drawing.Color]::FromArgb(255, 130, 148, 175)
            $pupil = [System.Drawing.Color]::FromArgb(255, 20, 24, 30)
            $lid = [System.Drawing.Color]::FromArgb(200, 35, 38, 44)
            $glow = [System.Drawing.Color]::Transparent
            $led = [System.Drawing.Color]::Transparent
        }
        'active' {
            $bg = [System.Drawing.Color]::FromArgb(255, 28, 10, 12)
            $sclera = [System.Drawing.Color]::FromArgb(255, 255, 245, 245)
            $scleraShade = [System.Drawing.Color]::FromArgb(255, 255, 220, 220)
            $irisA = [System.Drawing.Color]::FromArgb(255, 180, 20, 20)
            $irisB = [System.Drawing.Color]::FromArgb(255, 255, 90, 70)
            $pupil = [System.Drawing.Color]::FromArgb(255, 40, 0, 0)
            $lid = [System.Drawing.Color]::FromArgb(210, 50, 8, 12)
            $glow = [System.Drawing.Color]::FromArgb(90, 255, 60, 50)
            $led = [System.Drawing.Color]::Transparent
        }
        default {
            $bg = [System.Drawing.Color]::FromArgb(255, 8, 12, 22)
            $sclera = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
            $scleraShade = [System.Drawing.Color]::FromArgb(255, 232, 238, 248)
            $irisA = [System.Drawing.Color]::FromArgb(255, 10, 78, 200)
            $irisB = [System.Drawing.Color]::FromArgb(255, 48, 148, 255)
            $pupil = [System.Drawing.Color]::FromArgb(255, 0, 0, 0)
            $lid = [System.Drawing.Color]::FromArgb(200, 10, 14, 26)
            $glow = [System.Drawing.Color]::FromArgb(55, 30, 120, 255)
            $led = [System.Drawing.Color]::Transparent
        }
    }

    $g.Clear($bg)

    $cx = $Size / 2.0
    $cy = $Size / 2.0

    # Eye fills ~98% width, ~72% height — almost no padding
    $eyeW = $Size * 0.98
    $eyeH = $Size * 0.72
    $eyeX = ($Size - $eyeW) / 2.0
    $eyeY = ($Size - $eyeH) / 2.0

    if ($glow.A -gt 0) {
        $glowW = $eyeW * 1.02
        $glowH = $eyeH * 1.08
        $glowBrush = New-Object System.Drawing.SolidBrush($glow)
        $g.FillEllipse(
            $glowBrush,
            $cx - $glowW / 2,
            $cy - $glowH / 2,
            $glowW,
            $glowH
        )
        $glowBrush.Dispose()
    }

    # Sclera (white of eye) — horizontal ellipse
    $scleraRect = New-Object System.Drawing.RectangleF $eyeX, $eyeY, $eyeW, $eyeH
    $scleraBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $scleraRect,
        $sclera,
        $scleraShade,
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $g.FillEllipse($scleraBrush, $scleraRect)

    # Thin outer rim (camera housing hint)
    $rimPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 255, 255, 255), [Math]::Max(0.8, $Size / 32.0))
    $g.DrawEllipse($rimPen, $eyeX, $eyeY, $eyeW, $eyeH)

    # Iris — elliptical, large within sclera
    $irisW = $eyeW * 0.52
    $irisH = $eyeH * 0.88
    $irisX = $cx - $irisW / 2
    $irisY = $cy - $irisH / 2 + ($eyeH * 0.02)
    $irisRect = New-Object System.Drawing.RectangleF $irisX, $irisY, $irisW, $irisH
    $irisBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush((New-EllipsePath $irisX $irisY $irisW $irisH))
    $irisBrush.CenterColor = $irisB
    $irisBrush.SurroundColors = @($irisA)
    $irisBrush.FocusScales = New-Object System.Drawing.PointF 0.35, 0.45
    $g.FillEllipse($irisBrush, $irisRect)

    # Iris ring detail
    $irisRingPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 5, 40, 120), [Math]::Max(0.5, $Size / 48.0))
    $g.DrawEllipse($irisRingPen, $irisX, $irisY, $irisW, $irisH)

    # Pupil — vertical ellipse (human lens)
    $pupilW = $irisW * 0.42
    $pupilH = $irisH * 0.48
    $pupilX = $cx - $pupilW / 2
    $pupilY = $cy - $pupilH / 2 + ($eyeH * 0.03)
    $pupilBrush = New-Object System.Drawing.SolidBrush($pupil)
    $g.FillEllipse($pupilBrush, $pupilX, $pupilY, $pupilW, $pupilH)

    # Primary corneal reflection
    $glareW = $pupilW * 0.55
    $glareH = $pupilH * 0.35
    $glareX = $pupilX + $pupilW * 0.08
    $glareY = $pupilY + $pupilH * 0.12
    $glareBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 255, 255, 255))
    $g.FillEllipse($glareBrush, $glareX, $glareY, $glareW, $glareH)

    if ($Size -ge 24) {
        $g.FillEllipse(
            $glareBrush,
            $pupilX + $pupilW * 0.62,
            $pupilY + $pupilH * 0.58,
            [Math]::Max(1, $pupilW * 0.14),
            [Math]::Max(1, $pupilH * 0.12)
        )
    }

    # Upper eyelid shadow (realism)
    $lidH = $eyeH * 0.42
    $lidRect = New-Object System.Drawing.RectangleF ($eyeX - 1), ($eyeY - 1), ($eyeW + 2), ($lidH + 2)
    $lidBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $lidRect,
        $lid,
        [System.Drawing.Color]::FromArgb(0, $lid),
        [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    )
    $g.FillEllipse($lidBrush, $lidRect)

    # Lower lid subtle line
    if ($Size -ge 20) {
        $lowerY = $eyeY + $eyeH * 0.78
        $lowerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 40, 50, 70), [Math]::Max(0.5, $Size / 40.0))
        $g.DrawArc($lowerPen, $eyeX + $eyeW * 0.12, $lowerY - $eyeH * 0.08, $eyeW * 0.76, $eyeH * 0.22, 0, 180)
        $lowerPen.Dispose()
    }

    # Recording LED (active)
    if ($led.A -gt 0) {
        $ledD = [Math]::Max(2, $Size * 0.12)
        $ledBrush = New-Object System.Drawing.SolidBrush($led)
        $g.FillEllipse($ledBrush, $eyeX + $eyeW - $ledD - 1, $eyeY + 1, $ledD, $ledD)
        $ledBrush.Dispose()
    }

    $dir = Split-Path $Path -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose(); $bmp.Dispose()
    $scleraBrush.Dispose(); $irisBrush.Dispose(); $irisRingPen.Dispose()
    $pupilBrush.Dispose(); $glareBrush.Dispose(); $lidBrush.Dispose(); $rimPen.Dispose()
}

$root = $PSScriptRoot
foreach ($s in @(16, 48, 128)) {
    Save-HumanEyeIcon -Path (Join-Path $root "icon_$s.png") -Size $s -State 'off'
    Save-HumanEyeIcon -Path (Join-Path $root "icon_on_$s.png") -Size $s -State 'on'
    Save-HumanEyeIcon -Path (Join-Path $root "icon_active_$s.png") -Size $s -State 'active'
}

Write-Host "Generated elliptical human-eye icons in $root"
