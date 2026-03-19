{
  "targets": [
    {
      "target_name": "screencapture",
      "type": "loadable_module",
      "sources": [
        "audio_tap.mm"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CFLAGS": ["-ObjC++"],
            "OTHER_LDFLAGS": [
              "-framework ScreenCaptureKit",
              "-framework CoreAudio",
              "-framework CoreMedia",
              "-framework Foundation"
            ],
            "MACOSX_DEPLOYMENT_TARGET": "13.0"
          },
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
        }]
      ]
    }
  ]
}
