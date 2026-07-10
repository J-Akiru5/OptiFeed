import React from "react";

interface LogoProps {
	className?: string;
	size?: number;
}

/**
 * OptiFeed Logo Component
 * Subjects: Fish (Catfish silhouette), Feed Pellets (Precision/Scale), Water Ripples (Monitoring)
 * Treatment: Modern geometric fill with precise negative space.
 * Palette: Dark Blue (#0A3D62) and Safety Orange (#E85A2A).
 */
export function OptiFeedLogo({ className = "", size = 32 }: LogoProps) {
	return (
		<svg
			role="img"
			aria-label="OptiFeed Logo"
			width={size}
			height={size}
			viewBox="0 0 100 100"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
		>
			<title>OptiFeed Logo</title>
			{/* Background Rounded Square (Tile) */}
			<rect width="100" height="100" rx="24" fill="#0A3D62" />

			{/* Stylized Catfish / Wave Form */}
			<path
				d="M20 50C20 50 35 35 50 35C65 35 80 50 80 50C80 50 65 65 50 65C35 65 20 50 20 50Z"
				stroke="#E85A2A"
				strokeWidth="6"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>

			{/* Precision Feed Pellets (Three dots representing scale and timing) */}
			<circle cx="50" cy="50" r="8" fill="#E85A2A" />
			<circle cx="35" cy="50" r="4" fill="white" fillOpacity="0.4" />
			<circle cx="65" cy="50" r="4" fill="white" fillOpacity="0.4" />

			{/* Top and Bottom Ripples (Monitoring / Oversight) */}
			<path
				d="M35 25C45 20 55 20 65 25"
				stroke="white"
				strokeWidth="4"
				strokeLinecap="round"
				strokeOpacity="0.3"
			/>
			<path
				d="M35 75C45 80 55 80 65 75"
				stroke="white"
				strokeWidth="4"
				strokeLinecap="round"
				strokeOpacity="0.3"
			/>
		</svg>
	);
}
