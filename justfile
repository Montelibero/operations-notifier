IMAGE_NAME := "stellar_notifier"
CONTAINER_NAME := "stellar_notifier"


# Default target
default:
    @just --list

# Cleanup targets
clean:
    # Clean up build artifacts
    rm -rf build/
    rm -rf dist/
    rm -rf *.egg-info/
    find . -type d -name "__pycache__" -exec rm -rf {} +
    find . -type f -name "*.pyc" -delete

clean-docker:
    # Clean up Docker images and containers
    docker system prune -f
    docker volume prune -f

# Docker targets
build tag="latest":
    # Build Docker image
    #docker build --build-arg SERVICE_VERSION={--{VERSION}} -t {{IMAGE_NAME}}:{{tag}} .
    docker build -t {{IMAGE_NAME}}:{{tag}} .

push-docker1 tag="latest":
    docker pussh {{IMAGE_NAME}}:{{tag}} attid@docker1


push-gitdocker tag="latest":
    docker build -t {{IMAGE_NAME}}:{{tag}} .
    docker tag {{IMAGE_NAME}} ghcr.io/montelibero/{{IMAGE_NAME}}:{{tag}}
    docker push ghcr.io/montelibero/{{IMAGE_NAME}}:{{tag}}

run:
    docker run --rm --name {{CONTAINER_NAME}} -p 4021:4021 {{IMAGE_NAME}}

stop:
    docker stop {{CONTAINER_NAME}} || true
