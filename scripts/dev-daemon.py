#!/usr/bin/env python3
"""AMBER dev-server daemonizer: double-fork so the server is reparented to
PID 1 (same pattern the agent-browser daemon uses to survive bash-session
cleanup in this sandbox)."""
import os
import sys

if os.fork() > 0:
    sys.exit(0)  # parent exits immediately

os.setsid()

if os.fork() > 0:
    os._exit(0)  # intermediate exits; grandchild reparented to init

os.chdir('/home/z/my-project')
with open('/dev/null', 'r') as r, open('/dev/null', 'a') as w:
    os.dup2(r.fileno(), 0)
    os.dup2(w.fileno(), 1)
    os.dup2(w.fileno(), 2)

os.execvp('bun', ['bun', 'run', 'dev'])
