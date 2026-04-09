# vectorbee Python SDK

Python client SDK for talking to the local `vectorbee` proxy over a Unix domain socket.

## Install

```bash
pip install -e .
```

## Example

```python
from vectorbee import VectorBeeClient

client = VectorBeeClient()
prompt = client.get_prompt("support_reply")
print(prompt.template_text)

client.log_audit(prompt_name="support_reply", latency_ms=120, tokens=245)
```
