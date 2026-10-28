"""Make host compilers visible to the PlatformIO native environment on Windows.

The `native` platform deliberately uses the toolchain that is already on the
machine (see platform-native/platform.json: "uses built-in toolchains"). On a
Windows box without MinGW on PATH the build fails with `'gcc' is not recognized`
even though PlatformIO ships `toolchain-gccmingw32` in its package directory.

This pre-script only runs for `[env:native]`. It prepends that package's bin
directory when no host gcc is found, so `pio test -d firmware -e native` works
without a machine-wide PATH change. On Linux/macOS, or on a machine with gcc
installed, it does nothing.
"""

import os
import shutil

Import("env")

if shutil.which("gcc") is None and shutil.which("g++") is None:
    candidates = []
    core_dir = os.environ.get("PLATFORMIO_CORE_DIR")
    if core_dir:
        candidates.append(os.path.join(core_dir, "packages", "toolchain-gccmingw32", "bin"))
    candidates.append(os.path.join(os.path.expanduser("~"), ".platformio", "packages",
                                   "toolchain-gccmingw32", "bin"))
    candidates.append(os.path.join(os.environ.get("USERPROFILE", ""), ".platformio", "packages",
                                   "toolchain-gccmingw32", "bin"))

    for toolchain_bin in candidates:
        if os.path.isfile(os.path.join(toolchain_bin, "gcc.exe")):
            os.environ["PATH"] = toolchain_bin + os.pathsep + os.environ.get("PATH", "")
            env.PrependENVPath("PATH", toolchain_bin)
            print("native: using PlatformIO MinGW toolchain at %s" % toolchain_bin)
            break
    else:
        print("native: no host gcc found; install MinGW-w64 or put gcc on PATH")
