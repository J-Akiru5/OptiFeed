"""Copy the MinGW runtime DLLs beside the native test binary.

PlatformIO's `native` platform links against the host compiler, and the MinGW
that ships in the PlatformIO package directory is a 32-bit build whose
libgcc/libstdc++ DLLs are not on PATH. The `pio test` runner starts the binary
with the parent process PATH, so the Windows loader would fail with
STATUS_DLL_NOT_FOUND (0xC0000135) even though the build succeeded.

This post-script copies the three runtime DLLs next to program.exe when (and
only when) they exist and are not already there. On Linux/macOS it does
nothing. It is attached to [env:native] only.
"""

import os
import shutil

Import("env")

toolchain_bin = os.path.dirname(shutil.which("gcc") or "")
build_dir = env.subst("$BUILD_DIR")
program = os.path.join(build_dir, env.subst("$PROGNAME") + ".exe")

DLLS = ("libgcc_s_dw2-1.dll", "libstdc++-6.dll", "libwinpthread-1.dll")


def _copy_runtime(source, target, env):
    if not toolchain_bin:
        return
    for dll in DLLS:
        dll_source = os.path.join(toolchain_bin, dll)
        dll_target = os.path.join(build_dir, dll)
        if not os.path.isfile(dll_source):
            continue
        try:
            if not os.path.isfile(dll_target) or os.path.getmtime(dll_source) > os.path.getmtime(dll_target):
                shutil.copy2(dll_source, dll_target)
        except OSError as error:
            print("native: could not copy %s: %s" % (dll, error))


if toolchain_bin:
    env.AddPostAction(program, _copy_runtime)

