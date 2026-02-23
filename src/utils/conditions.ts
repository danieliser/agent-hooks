import { debugDispatcher } from "./debug.js";

/**
 * Simple jq-like condition evaluator.
 * Supports basic paths, comparisons, and exists checks.
 * For complex expressions, gracefully degrades.
 * Returns { success: boolean, result: unknown, error?: string }
 */
function simpleEvaluate(expression: string, data: Record<string, unknown>): { success: boolean; result: unknown; error?: string } {
  // Simple jq expression parser for basic cases
  expression = expression.trim();

  // Handle pipe operations first (basic support): .field | length > 2
  if (expression.includes("|")) {
    const pipeIndex = expression.indexOf("|");
    const leftExpr = expression.substring(0, pipeIndex).trim();
    const rightExpr = expression.substring(pipeIndex + 1).trim();

    // Evaluate the left side
    const leftResult = simpleEvaluate(leftExpr, data);
    if (!leftResult.success) return leftResult;

    let pipeValue = leftResult.result;

    // Process the right side (filters like "length" or "length > 2")
    if (rightExpr === "length") {
      const lengthValue = Array.isArray(pipeValue) ? pipeValue.length : typeof pipeValue === "string" ? pipeValue.length : undefined;
      return { success: true, result: lengthValue };
    }

    // Check for "length <op> <value>" patterns
    const lengthCompMatch = rightExpr.match(/^length\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
    if (lengthCompMatch) {
      const [, operator, valueStr] = lengthCompMatch;
      const lengthValue = Array.isArray(pipeValue) ? pipeValue.length : typeof pipeValue === "string" ? pipeValue.length : undefined;
      let compareValue: unknown = valueStr;
      if (/^\d+$/.test(valueStr)) compareValue = parseInt(valueStr, 10);
      else if (/^\d+\.\d+$/.test(valueStr)) compareValue = parseFloat(valueStr);

      const boolResult = evaluateComparison(operator, lengthValue, compareValue);
      return { success: true, result: boolResult };
    }

    return { success: false, result: undefined, error: `Unsupported pipe operation: ${rightExpr}` };
  }

  // Handle simple path access with optional comparison: .field or .field.nested or .field == value
  if (expression.startsWith(".")) {
    const path = expression.substring(1);

    // Check for direct comparisons: .field == value, .field > number, etc.
    const comparisonMatch = path.match(/^([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
    if (comparisonMatch) {
      const [, fieldPath, operator, valueStr] = comparisonMatch;
      const fieldValue = getNestedValue(data, fieldPath);
      let compareValue: unknown = parseValue(valueStr);

      const boolResult = evaluateComparison(operator, fieldValue, compareValue);
      return { success: true, result: boolResult };
    }

    // Simple field access (no comparison)
    return { success: true, result: getNestedValue(data, path) };
  }

  // Expression doesn't match any known pattern
  return { success: false, result: undefined, error: "Unsupported expression format" };
}

function parseValue(valueStr: string): unknown {
  if (valueStr === "true") return true;
  if (valueStr === "false") return false;
  if (valueStr === "null") return null;
  if (valueStr === "undefined") return undefined;
  if (/^\d+$/.test(valueStr)) return parseInt(valueStr, 10);
  if (/^\d+\.\d+$/.test(valueStr)) return parseFloat(valueStr);
  if (/^".*"$/.test(valueStr)) return valueStr.slice(1, -1);
  if (/^'.*'$/.test(valueStr)) return valueStr.slice(1, -1);
  return valueStr;
}

function evaluateComparison(operator: string, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    case ">":
      return (left as any) > (right as any);
    case "<":
      return (left as any) < (right as any);
    case ">=":
      return (left as any) >= (right as any);
    case "<=":
      return (left as any) <= (right as any);
    default:
      return false;
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: any = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

export async function evaluateCondition(
  expression: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    debugDispatcher("evaluating condition=%s", expression);

    // Try to use jq-web if available
    let result: unknown;
    let usingFallback = false;
    try {
      // Dynamic import to avoid hard dependency
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const jqModule = await import("jq-web" as any);
      const jq = jqModule.default || jqModule;
      if (jq && typeof (jq as any).json === "function") {
        result = (jq as any).json(data, expression);
        debugDispatcher("evaluated with jq-web");
      } else {
        // Fallback to simple evaluator if jq-web doesn't have expected API
        const evalResult = simpleEvaluate(expression, data);
        if (!evalResult.success) {
          console.warn(`[agent-hooks] Unsupported when expression "${expression}": ${evalResult.error}`);
          return true; // Graceful degradation: execute if expression is unsupported
        }
        result = evalResult.result;
        usingFallback = true;
        debugDispatcher("evaluated with fallback parser");
      }
    } catch (jqErr) {
      // jq-web not available, use simple fallback
      debugDispatcher("jq-web not available, using fallback evaluator: %s", jqErr instanceof Error ? jqErr.message : String(jqErr));
      const evalResult = simpleEvaluate(expression, data);
      if (!evalResult.success) {
        console.warn(`[agent-hooks] Unsupported when expression "${expression}": ${evalResult.error}`);
        return true; // Graceful degradation: execute if expression is unsupported
      }
      result = evalResult.result;
      usingFallback = true;
    }

    // Truthy: non-null, non-false, non-empty
    const matched = result !== null && result !== false && result !== "" && result !== undefined;
    debugDispatcher("condition result=%s matched=%s", JSON.stringify(result), matched);
    return matched;
  } catch (err) {
    // Graceful degradation: invalid expression → log warning, execute anyway
    debugDispatcher("condition evaluation failed: %s", err instanceof Error ? err.message : String(err));
    console.warn(`[agent-hooks] Invalid when expression "${expression}": ${err instanceof Error ? err.message : String(err)}`);
    return true; // Safe default: execute if condition is malformed
  }
}
