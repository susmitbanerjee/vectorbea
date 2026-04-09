"""Simple example showing how to use the vectorbee Python SDK."""

from vectorbee import VectorBeeClient


def main() -> None:
    with VectorBeeClient(sock_path="/tmp/vectorbee.sock") as client:
        prompt = client.get_prompt("support_reply")
        print("Template:", prompt.template_text)
        print("Parameters:", prompt.parameters)

        client.log_audit(
            prompt_name="support_reply",
            latency_ms=142,
            tokens=311,
        )


if __name__ == "__main__":
    main()
