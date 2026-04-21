ARG BASE_IMAGE=optio-base:latest
FROM ${BASE_IMAGE}

USER root

# Ruby via rbenv
RUN apt-get update && apt-get install -y \
    build-essential libssl-dev libreadline-dev zlib1g-dev \
    libyaml-dev libffi-dev libgmp-dev \
    && rm -rf /var/lib/apt/lists/*


# Install rbenv and ruby-build
ENV RBENV_ROOT="/opt/rbenv"
ENV PATH="${RBENV_ROOT}/bin:${RBENV_ROOT}/shims:${PATH}"
RUN mkdir /opt/rbenv && git clone https://github.com/rbenv/rbenv.git ${RBENV_ROOT} \
    && git clone https://github.com/rbenv/ruby-build.git ${RBENV_ROOT}/plugins/ruby-build

# Install latest stable Ruby (3.3)
RUN rbenv install 3.3.6 && rbenv global 3.3.6

# Common tools
RUN gem install bundler rake rubocop solargraph

USER agent
