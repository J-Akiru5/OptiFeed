"use client";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<html lang="en">
			<body>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "100vh",
						fontFamily: "system-ui, sans-serif",
						gap: "1rem",
					}}
				>
					<h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Something went wrong</h2>
					<button
						type="button"
						onClick={() => reset()}
						style={{
							padding: "0.5rem 1.5rem",
							borderRadius: "0.5rem",
							background: "#E85A2A",
							color: "white",
							border: "none",
							fontWeight: 600,
							cursor: "pointer",
						}}
					>
						Try again
					</button>
				</div>
			</body>
		</html>
	);
}
