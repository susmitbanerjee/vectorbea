"""Simple example showing how to use the vectorbea Python SDK."""

from vectorbea import VectorBeaClient


def main() -> None:
    with VectorBeaClient(sock_path="/tmp/vectorbea.sock") as client:
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
