from openai import OpenAI


def main() -> None:
    client = OpenAI(
        base_url="http://localhost:8080/v1",
        api_key="vectorbea-local-dev",
    )

    response = client.chat.completions.create(
        model="vectorbea-local",
        messages=[
            {
                "role": "system",
                "content": "You are validating the local VectorBea developer sandbox.",
            },
            {
                "role": "user",
                "content": "Summarize why outbound dialing agents keep customer execution local.",
            },
        ],
        extra_body={
            "prompt_name": "support_reply",
        },
    )

    print(response.choices[0].message.content)


if __name__ == "__main__":
    main()
