/**
 * The drawing that stands in for Jeff's feeder photo (task I-29, E29).
 *
 * Pure SVG, no client hooks: the hero renders it under the photo so the hero
 * is never empty, and it stays visible when the photo is missing. Purely
 * decorative — every number lives in the callouts, which is why it is hidden
 * from assistive tech.
 */
export function FeederIllustration({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 400 300"
			className={className}
			aria-hidden="true"
			focusable="false"
			preserveAspectRatio="xMidYMid meet"
			data-testid="feeder-illustration"
		>
			<defs>
				<linearGradient id="feeder-hero-hopper" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#3f8cc8" />
					<stop offset="1" stopColor="#0d3c60" />
				</linearGradient>
				<linearGradient id="feeder-hero-housing" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#a7c9e8" />
					<stop offset="1" stopColor="#436f95" />
				</linearGradient>
				<linearGradient id="feeder-hero-post" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stopColor="#7b97ae" />
					<stop offset="1" stopColor="#2c465e" />
				</linearGradient>
				<linearGradient id="feeder-hero-water" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#12455f" />
					<stop offset="1" stopColor="#061620" />
				</linearGradient>
				<radialGradient id="feeder-hero-glow" cx="50%" cy="42%" r="52%">
					<stop offset="0" stopColor="#E85A2A" stopOpacity="0.22" />
					<stop offset="1" stopColor="#E85A2A" stopOpacity="0" />
				</radialGradient>
			</defs>

			<rect width="400" height="300" fill="url(#feeder-hero-glow)" />

			{/* The pond: still water, so nothing moves for a reduced-motion reader. */}
			<path d="M0 240c54-10 108 6 168 0s140-12 232 2v58H0Z" fill="url(#feeder-hero-water)" />
			<g fill="none" stroke="#8fc0ea" strokeLinecap="round" opacity="0.28">
				<path d="M28 254c26-6 56-6 82 0" strokeWidth="1.5" />
				<path d="M240 258c30-7 66-7 96 0" strokeWidth="1.5" />
				<path d="M120 272c34-6 74-6 108 0" strokeWidth="1.2" />
			</g>

			{/* Post and footing. */}
			<rect x="191" y="150" width="16" height="94" rx="4" fill="url(#feeder-hero-post)" />
			<ellipse cx="199" cy="246" rx="30" ry="7" fill="#04121b" opacity="0.7" />

			{/* Hopper: lid, tapered body, and the feed visible through the window. */}
			<path d="M150 64h100l-24 80h-52Z" fill="url(#feeder-hero-hopper)" />
			<path
				d="M150 64h100l-24 80h-52Z"
				fill="none"
				stroke="#bcd9f2"
				strokeOpacity="0.45"
				strokeWidth="1.5"
			/>
			<ellipse
				cx="200"
				cy="64"
				rx="50"
				ry="9"
				fill="#0b2f4a"
				stroke="#bcd9f2"
				strokeOpacity="0.5"
				strokeWidth="1.5"
			/>
			<rect x="185" y="80" width="30" height="46" rx="7" fill="#04121b" opacity="0.85" />
			<rect x="189" y="94" width="22" height="28" rx="4" fill="#e8b06a" />
			<rect x="189" y="94" width="22" height="6" rx="3" fill="#f5d3a0" />

			{/* Motor housing with the status light and vent slots. */}
			<rect x="166" y="142" width="68" height="54" rx="11" fill="url(#feeder-hero-housing)" />
			<rect
				x="166"
				y="142"
				width="68"
				height="54"
				rx="11"
				fill="none"
				stroke="#dcebfa"
				strokeOpacity="0.45"
				strokeWidth="1.5"
			/>
			<circle cx="180" cy="160" r="4" fill="#4ade80" />
			<g stroke="#0d2b3f" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round">
				<path d="M208 160h14" />
				<path d="M208 168h14" />
				<path d="M208 176h14" />
			</g>

			{/* Spout, with pellets on the way to the water. */}
			<path
				d="M226 176c20 3 32 14 39 28l-10 5c-6-12-16-21-33-24Z"
				fill="#c9dcee"
				stroke="#9fc0da"
				strokeWidth="1"
			/>
			<g fill="#e8b06a">
				<circle cx="262" cy="214" r="2.6" />
				<circle cx="268" cy="223" r="2.2" />
				<circle cx="255" cy="222" r="1.8" />
			</g>

			{/* A small water line marker where the probe sits. */}
			<path
				d="M0 240c54-10 108 6 168 0s140-12 232 2"
				fill="none"
				stroke="#8fc0ea"
				strokeOpacity="0.5"
				strokeWidth="2"
			/>
		</svg>
	);
}
