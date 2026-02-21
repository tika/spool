import type { Context } from "hono";

type ValidationResult<T> =
	| { success: true; data: T }
	| {
			success: false;
			error: {
				issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
			};
	  };

export function handleZodError<T>(
	result: ValidationResult<T>,
	c: Context,
): Response | undefined {
	if (!result.success) {
		const issues = result.error.issues.map((issue) => ({
			path: issue.path.join("."),
			message: issue.message,
		}));

		return c.json(
			{
				error: {
					code: "VALIDATION_ERROR",
					message: issues[0]?.message || "Invalid request",
					details: issues,
				},
			},
			400,
		);
	}
}
