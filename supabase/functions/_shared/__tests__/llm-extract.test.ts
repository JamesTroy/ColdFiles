import { describe, expect, it } from 'vitest';

import { parseExtractionJson } from '../llm-extract.ts';

describe('parseExtractionJson', () => {
  it('parses a plain JSON response with all fields', () => {
    const text = JSON.stringify({
      candidate: '100 block of Bernard Street, Houma, LA',
      confidence: 0.85,
      reasoning: 'Specific block-level address from the narrative.',
    });
    const r = parseExtractionJson(text);
    expect(r.candidate).toBe('100 block of Bernard Street, Houma, LA');
    expect(r.confidence).toBe(0.85);
    expect(r.reasoning).toBe('Specific block-level address from the narrative.');
  });

  it('strips markdown code-fences when the model hedges', () => {
    // Models occasionally wrap JSON in ```json … ``` despite the
    // system instruction. The parser must tolerate it rather than
    // throw — we'd rather get the data than burn an LLM call.
    const text =
      '```json\n' +
      JSON.stringify({
        candidate: 'University of Alaska, Anchorage, AK',
        confidence: 0.8,
        reasoning: 'Named institution in the narrative.',
      }) +
      '\n```';
    const r = parseExtractionJson(text);
    expect(r.candidate).toBe('University of Alaska, Anchorage, AK');
    expect(r.confidence).toBe(0.8);
  });

  it('null candidate is preserved as null, not coerced', () => {
    const text = JSON.stringify({
      candidate: null,
      confidence: 0.3,
      reasoning: 'Only "his apartment" — too vague to geocode.',
    });
    const r = parseExtractionJson(text);
    expect(r.candidate).toBeNull();
    expect(r.confidence).toBe(0.3);
  });

  it('empty-string candidate is treated as null', () => {
    // Defensive — some models emit an empty string for "no result"
    // despite the instruction. Treat it as null so the orchestrator
    // logs 'rejected_no_signal' instead of trying to geocode "".
    const text = JSON.stringify({
      candidate: '',
      confidence: 0.4,
      reasoning: 'No specific signal.',
    });
    const r = parseExtractionJson(text);
    expect(r.candidate).toBeNull();
  });

  it('candidate with whitespace gets trimmed', () => {
    const text = JSON.stringify({
      candidate: '  3rd and South Streets, Philadelphia, PA  ',
      confidence: 0.85,
      reasoning: 'Intersection.',
    });
    const r = parseExtractionJson(text);
    expect(r.candidate).toBe('3rd and South Streets, Philadelphia, PA');
  });

  it('confidence is clamped to [0, 1]', () => {
    // Models occasionally output 0.95 as 95 (interpreting as percent)
    // or write -0.1 / 1.5 from arithmetic. Clamp rather than throw —
    // a clamped 1.0 still passes the threshold gate, which is the
    // editorially conservative direction.
    const high = parseExtractionJson(
      JSON.stringify({ candidate: 'X', confidence: 1.5, reasoning: '.' }),
    );
    expect(high.confidence).toBe(1);
    const low = parseExtractionJson(
      JSON.stringify({ candidate: 'X', confidence: -0.1, reasoning: '.' }),
    );
    expect(low.confidence).toBe(0);
  });

  it('non-numeric confidence becomes null', () => {
    const r = parseExtractionJson(
      JSON.stringify({
        candidate: 'X',
        confidence: 'high',
        reasoning: '.',
      }),
    );
    expect(r.confidence).toBeNull();
  });

  it('throws on non-JSON output', () => {
    expect(() => parseExtractionJson('I cannot answer that.')).toThrow(
      /not valid JSON/,
    );
  });

  it('throws on JSON that is not an object', () => {
    expect(() => parseExtractionJson('"just a string"')).toThrow(
      /not an object/,
    );
  });

  it('missing reasoning falls back to placeholder rather than throwing', () => {
    // We don't want a missing reasoning to fail the whole extraction —
    // the audit-log entry is allowed to carry a placeholder. Keep
    // the pipeline robust against minor schema deviations.
    const r = parseExtractionJson(
      JSON.stringify({ candidate: 'X', confidence: 0.8 }),
    );
    expect(r.reasoning).toBe('(no reasoning)');
  });
});
