#!/usr/bin/env python3
"""pty-relay.py — lance une commande dans un VRAI pseudo-terminal (30 lignes, PTY_COLS colonnes, 80 par défaut) et
relaie : notre entrée standard → le clavier du terminal, l'écran du terminal → notre sortie standard.
Sert aux tests d'archive-node (pair.test.ts) : saisie tapée d'avance, mode brut, Ctrl+C, comme un humain au clavier.
(La commande « script » de macOS refuse une entrée qui n'est pas un terminal ; Python a le module pty partout.)
Usage : python3 pty-relay.py <commande> [arguments…]
Code de sortie : celui de la commande (128 + n si un signal n l'a tuée)."""
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
    if pid == 0:  # l'enfant : le terminal a sa taille AVANT le lancement de la commande
        try:
            fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 30, cols, 0, 0))
            os.execvp(sys.argv[1], sys.argv[1:])
        finally:
            os._exit(127)

    def pump(timeout: float) -> str:
        """recopie ce que le terminal affiche : « data », « idle » (rien dans le délai) ou « closed »"""
        r, _, _ = select.select([fd], [], [], timeout)
        if not r:
            return "idle"
        try:
            data = os.read(fd, 65536)
        except OSError:  # EIO : plus personne côté commande
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
                stdin_open = False  # fin de notre entrée : on cesse de taper, sans fermer le terminal
        if pump(0.02) == "closed":
            break
        done, st = os.waitpid(pid, os.WNOHANG)
        if done:
            status = st
    # la commande est finie : ce qu'elle a encore affiché (jusqu'à la fermeture, ou 0,2 s sans rien, 2 s au plus)
    deadline = time.time() + 2.0
    while time.time() < deadline and pump(0.2) == "data":
        pass
    if status is None:
        _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main())
