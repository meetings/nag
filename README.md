
nag
===

Simple tool to poll services and report errors
(by email and sms) if service seems to be down.


Configuration
-------------

Nag expects to find a properly formatted JSON configuration file in **/etc/nag.conf**.

Configuration must have the following properties:

 + poll\_interval - The time to wait between polling services (in ms).

 + parallel\_limit - The number of parallel poll requests.

 + mail\_sender - Alert mail from field.
 + mail\_recipients - A list of comma separated mail recipients.
 + mail\_server\_opts - A JSON object:
   * user - Login name.
   * password - Password.
   * host - Mail server address.
   * ssl - Value of either "true" of "false".

 + sms\_recipients - A JSON array of phone numbers to send text message to.

 + TODO...
