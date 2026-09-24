FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir --disable-pip-version-check -r /tmp/requirements.txt

COPY proctoring_inference/ ${LAMBDA_TASK_ROOT}/proctoring_inference/
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
CMD ["proctoring_inference.handler.lambda_handler"]
