FROM node:20.11.1-buster

WORKDIR /

ARG ECOURSE_REPO=https://github.com/Ilyas-Codes/eCourse.git
RUN rm -rf eCourse
RUN git clone ${ECOURSE_REPO} eCourse

ARG PB_VERSION=0.21.3
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /eCourse/pb

WORKDIR /eCourse/ui

RUN sed -i 's/^VITE_PROD_PB_URL=.*/VITE_PROD_PB_URL=http:\/\/192.168.68.51:8090/' .env
RUN npm install
RUN npm run build
RUN mv dist/* /eCourse/pb/pb_public

EXPOSE 8090

CMD ["/eCourse/pb/pocketbase", "serve", "--http=0.0.0.0:8090"] 