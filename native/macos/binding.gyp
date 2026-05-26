{
  "targets": [
    {
      "target_name": "meetu_screencapture",
      "type": "loadable_module",
      "sources": [
        "audio_tap.mm"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "OTHER_CFLAGS": [
              "-ObjC++",
              "-fobjc-arc"
            ],
            "OTHER_LDFLAGS": [
              "-framework ScreenCaptureKit",
              "-framework CoreAudio",
              "-framework CoreMedia",
              "-framework AVFoundation",
              "-framework AppKit",
              "-framework Foundation"
            ],
            "MACOSX_DEPLOYMENT_TARGET": "13.0",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
          },
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "defines": [
            "NAPI_VERSION=8",
            "NODE_ADDON_API_REQUIRE_BASIC_FINALIZERS"
          ]
        }]
      ]
    }
  ]
}
