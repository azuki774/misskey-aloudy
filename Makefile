.PHONY: help build smoke with-voicevox play-audio clean kill-server

PORT ?= 4398
HOST ?= 127.0.0.1
TEXT ?= こんにちは
SPEAKER ?= 1
AUDIO_FILE ?= /tmp/misskey-aloudy-smoke.wav
LOG_FILE ?= /tmp/misskey-aloudy-smoke.log
PID_FILE ?= /tmp/misskey-aloudy-smoke.pid

help:
	@echo "Manual verification targets for the VoiceVox API client."
	@echo ""
	@echo "  make smoke            Build, boot the production server, and verify"
	@echo "                        POST /api/speech for both error paths (400, 502)."
	@echo "                        Does NOT require a running VoiceVox engine."
	@echo ""
	@echo "  make with-voicevox    Same as 'smoke' but also synthesizes a real WAV"
	@echo "                        via the docker-compose'd VoiceVox engine."
	@echo "                        Run 'docker compose up -d voicevox' first."
	@echo ""
	@echo "  make play-audio       Play $(AUDIO_FILE) using ffplay/aplay/afplay."
	@echo ""
	@echo "  make build            Build the production bundle into dist/."
	@echo "  make kill-server      Kill any process listening on port $(PORT)."
	@echo "  make clean            Remove dist/ and $(AUDIO_FILE)."
	@echo ""
	@echo "Variables: PORT=$(PORT) HOST=$(HOST) TEXT='$(TEXT)' SPEAKER=$(SPEAKER) AUDIO_FILE=$(AUDIO_FILE)"

build:
	bun run build

kill-server:
	@if [ -f $(PID_FILE) ]; then \
		PID=$$(cat $(PID_FILE) 2>/dev/null); \
		if [ -n "$$PID" ] && kill -0 $$PID 2>/dev/null; then \
			kill $$PID 2>/dev/null || true; \
			sleep 0.3; \
			kill -9 $$PID 2>/dev/null || true; \
		fi; \
		rm -f $(PID_FILE); \
	fi
	@PIDS=$$(lsof -ti tcp:$(PORT) 2>/dev/null); \
	if [ -n "$$PIDS" ]; then \
		echo "$$PIDS" | xargs -r kill -9 2>/dev/null || true; \
		sleep 0.3; \
	fi
	@echo "Port $(PORT) is free."

smoke: build kill-server
	@if [ -f $(PID_FILE) ]; then rm -f $(PID_FILE); fi
	@PORT=$(PORT) HOST=$(HOST) nohup node dist/server/entry.mjs > $(LOG_FILE) 2>&1 & \
		echo $$! > $(PID_FILE); \
		disown
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -fsS -o /dev/null http://$(HOST):$(PORT)/ 2>/dev/null; then break; fi; \
		sleep 0.3; \
	done
	@echo "--- empty body (expect 400) ---"
	@curl -s -X POST http://$(HOST):$(PORT)/api/speech -H "Content-Type: application/json" -d '{}' -w "\nHTTP %{http_code}\n"
	@echo "--- bad speaker (expect 400) ---"
	@curl -s -X POST http://$(HOST):$(PORT)/api/speech -H "Content-Type: application/json" -d '{"text":"hello","speaker":-1}' -w "\nHTTP %{http_code}\n"
	@echo "--- invalid JSON (expect 400) ---"
	@curl -s -X POST http://$(HOST):$(PORT)/api/speech -H "Content-Type: application/json" -d 'not-json' -w "\nHTTP %{http_code}\n"
	@echo "--- VoiceVox not running (expect 502) ---"
	@curl -s -X POST http://$(HOST):$(PORT)/api/speech -H "Content-Type: application/json" -d '{"text":"hello"}' --max-time 5 -w "\nHTTP %{http_code}\n"
	@$(MAKE) --no-print-directory kill-server

with-voicevox: build kill-server
	@if ! curl -fsS -o /dev/null --max-time 2 http://$(HOST):50021/version 2>/dev/null; then \
		echo "VoiceVox engine not reachable at http://$(HOST):50021."; \
		echo "Run 'docker compose up -d voicevox' first, then retry."; \
		exit 1; \
	fi
	@if [ -f $(PID_FILE) ]; then rm -f $(PID_FILE); fi
	@PORT=$(PORT) HOST=$(HOST) PUBLIC_VOICEVOX_URL=http://$(HOST):50021 nohup node dist/server/entry.mjs > $(LOG_FILE) 2>&1 & \
		echo $$! > $(PID_FILE); \
		disown
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -fsS -o /dev/null http://$(HOST):$(PORT)/ 2>/dev/null; then break; fi; \
		sleep 0.3; \
	done
	@echo "--- synthesizing '$(TEXT)' to $(AUDIO_FILE) ---"
	@curl -fsS -X POST http://$(HOST):$(PORT)/api/speech \
		-H "Content-Type: application/json" \
		-d "{\"text\":\"$(TEXT)\",\"speaker\":$(SPEAKER)}" \
		--output $(AUDIO_FILE) -w "HTTP %{http_code}, %{size_download} bytes, type=%{content_type}\n"
	@file $(AUDIO_FILE) 2>/dev/null || ls -la $(AUDIO_FILE)
	@$(MAKE) --no-print-directory kill-server
	@echo ""
	@echo "WAV saved to $(AUDIO_FILE). Run 'make play-audio' to listen."

play-audio:
	@if [ ! -f $(AUDIO_FILE) ]; then \
		echo "$(AUDIO_FILE) not found. Run 'make with-voicevox' first."; \
		exit 1; \
	fi
	@if command -v ffplay >/dev/null 2>&1; then \
		ffplay -autoexit -nodisp -loglevel error $(AUDIO_FILE); \
	elif command -v aplay >/dev/null 2>&1; then \
		aplay -q $(AUDIO_FILE); \
	elif command -v afplay >/dev/null 2>&1; then \
		afplay $(AUDIO_FILE); \
	else \
		echo "No audio player found (ffplay/aplay/afplay). File: $(AUDIO_FILE)"; \
		exit 1; \
	fi

clean:
	@rm -rf dist $(AUDIO_FILE) $(LOG_FILE) $(PID_FILE)
	@echo "Cleaned dist/ and $(AUDIO_FILE)."
