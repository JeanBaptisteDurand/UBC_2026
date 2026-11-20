#!/usr/bin/env python3
"""pty-relay.py — runs a command in a REAL pseudo-terminal (30 rows, PTY_COLS columns, 80 by default) and
relays: our standard input → the terminal's keyboard, the terminal's screen → our standard output.
Used by archive-node's tests (pair.test.ts): input typed ahead, raw mode, Ctrl+C, like a person at the keyboard.
(macOS's "script" command refuses an input that is not a terminal; Python has the pty module everywhere.)
Usage: python3 pty-relay.py <command> [arguments…]
Exit code: the command's own (128 + n if signal n killed it)."""
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time


def main() -> int:
    cols = int(os.environ.get("PTY_COLS", "80"))
    pid, fd = pty.fork()
    if pid == 0:  # the child: the terminal has its size BEFORE the command starts
        try:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 30, cols, 0, 0))
            os.execvp(sys.argv[1], sys.argv[1:])
        finally:
            os._exit(127)

    def pump(timeout: float) -> str:
        """copies what the terminal shows: "data", "idle" (nothing within the timeout) or "closed\""""
        r, _, _ = select.select([fd], [], [], timeout)
        if not r:
            return "idle"
        try:
            data = os.read(fd, 65536)
        except OSError:  # EIO: nobody left on the command's side
            return "closed"
        if not data:
            return "closed"
        os.write(1, data)
        return "data"

    stdin_open = True
    status = None
    while status is None:
        r, _, _ = select.select([0] if stdin_open else [], [], [], 0)
        if r:
            data = os.read(0, 65536)
            if data:
                os.write(fd, data)
            else:
                stdin_open = False  # end of our input: stop typing, without closing the terminal
        if pump(0.02) == "closed":
            break
        done, st = os.waitpid(pid, os.WNOHANG)
        if done:
            status = st
    # the command has ended: what it still showed (until closing, or 0.2 s of nothing, 2 s at most)
    deadline = time.time() + 2.0
    while time.time() < deadline and pump(0.2) == "data":
        pass
    if status is None:
        _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main())
