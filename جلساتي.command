#!/bin/zsh
# تشغيل "جلساتي" بنقرة مزدوجة: يشغّل الخادم إن لم يكن يعمل، ثم يفتح المتصفح.
cd "$(dirname "$0")"
PORT=4477
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  nohup node server.mjs > data/server.log 2>&1 &
  for i in {1..20}; do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.3; done
fi
open "http://localhost:$PORT/"
