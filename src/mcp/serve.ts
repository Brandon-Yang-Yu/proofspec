#!/usr/bin/env node
import { serveMcp } from './server.ts'

/**
 * The stdio MCP server's own entry: the command a Claude Code config names. It serves the
 * one core on this process's own stdio and lives exactly as long as the stream pair does —
 * the harness that started it owns its exit, so nothing here exits on its own.
 */
serveMcp({ input: process.stdin, output: process.stdout })
