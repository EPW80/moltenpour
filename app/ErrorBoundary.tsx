import { Component, type ReactNode } from "react";

import { COLOR, FONT, RADIUS } from "./design/tokens";

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * The last line of defence against a blank page. A render error anywhere below
 * unmounts the whole tree with no recourse; this catches it and offers the one
 * recovery that always applies — reload — in the register's own voice rather
 * than a browser error.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    // There is no recovery to offer beyond reload, but the console must at
    // least name what threw while the page is still inspectable.
    console.error("app render failure", error, info);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLOR.shadeDeep,
          color: COLOR.goldBody,
          fontFamily: FONT.instrument,
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: 440,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            border: `1px solid ${COLOR.ruleMid}`,
            borderRadius: RADIUS.panel,
            padding: 28,
            background: "rgba(22,11,26,.6)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: "3.2px",
              textTransform: "uppercase",
              color: COLOR.goldLabel,
            }}
          >
            Office of Disbursement · register unavailable
          </span>
          <span
            style={{
              fontFamily: FONT.display,
              fontStyle: "italic",
              fontSize: 24,
              lineHeight: 1.15,
              color: COLOR.goldCream,
            }}
          >
            The register could not be read.
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              alignSelf: "flex-start",
              padding: "10px 16px",
              background: "transparent",
              border: `1px solid ${COLOR.ruleStage}`,
              borderRadius: RADIUS.button,
              color: COLOR.goldCream,
              fontFamily: FONT.instrument,
              fontSize: 11,
              letterSpacing: "2.6px",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Reload the register
          </button>
        </div>
      </div>
    );
  }
}